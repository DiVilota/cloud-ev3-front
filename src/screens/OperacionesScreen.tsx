import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LogPanel } from '../components/LogPanel'
import { PageHeader } from '../components/Shell'
import { Badge, Bar, Button, Card, Empty, Field, Input, Metric, Notice, Table } from '../components/ui'
import { WS_URL } from '../config'
import { useLog } from '../hooks/useLog'
import { usePolling } from '../hooks/usePolling'
import { useWebSocket } from '../hooks/useWebSocket'
import { pagos, recomendaciones } from '../lib/api'
import { describirEspera } from '../lib/backoff'
import { fechaHora, num } from '../lib/format'
import type { Metricas, ResumenAlertas } from '../lib/types'

type Fuente = 'nada' | 'poll' | 'ws'

/* Lectura periódica fija: el tablero se refresca cada 5 s. Si un servicio falla,
   usePolling aplica su espera creciente y se rinde tras varios fallos seguidos. */
const INTERVALO_MS = 5000

/* Minutos que se muestran en la serie: los últimos 15. */
const VENTANA_MINUTOS = 15

const hora = (ms: number) =>
  new Date(ms).toLocaleTimeString('es-CL', { hour12: false, hour: '2-digit', minute: '2-digit' })

export function OperacionesScreen() {
  const [url, setUrl] = useState(WS_URL)
  const [fuente, setFuente] = useState<Fuente>('poll')
  const [metricas, setMetricas] = useState<Metricas | null>(null)
  const [alertas, setAlertas] = useState<ResumenAlertas | null>(null)
  const { lineas, log, limpiar } = useLog()

  /* Último error registrado por servicio. Sin esto, un servicio caído escribe
     la misma línea en cada vuelta y el registro deja de servir para ver qué
     pasó: sólo se anota cuando el mensaje CAMBIA. */
  const ultimoError = useRef<Record<string, string>>({})

  const registrarFallo = useCallback(
    (servicio: string, mensaje: string) => {
      if (ultimoError.current[servicio] !== mensaje) {
        ultimoError.current[servicio] = mensaje
        log(`${servicio}: ${mensaje}`, 'error')
      }
    },
    [log],
  )

  /* Lectura directa de los microservicios: las mismas métricas que después
     llegan empujadas por el WebSocket. Permite trabajar el tablero sin AWS.

     Lanza sólo si fallan LOS DOS: con uno vivo el tablero sigue sirviendo, así
     que no corresponde castigar el intervalo por una caída parcial. */
  const leerDeServicios = useCallback(async () => {
    const [m, a] = await Promise.allSettled([recomendaciones.metricas(), pagos.alertas()])

    if (m.status === 'fulfilled') {
      setMetricas(m.value)
      delete ultimoError.current.metricas
    } else {
      registrarFallo('metricas', (m.reason as Error).message)
    }

    if (a.status === 'fulfilled') {
      setAlertas(a.value)
      delete ultimoError.current.alertas
    } else {
      registrarFallo('alertas', (a.reason as Error).message)
    }

    if (m.status === 'rejected' && a.status === 'rejected') {
      throw new Error('ningún servicio respondió')
    }
  }, [registrarFallo])

  const poll = usePolling({ tarea: leerDeServicios, base: INTERVALO_MS, max: INTERVALO_MS, onAviso: log })

  /* Arranca la lectura al entrar a la pantalla. */
  useEffect(() => {
    log(`leyendo de :8084/api/metricas y :8083/api/alertas cada ${INTERVALO_MS / 1000} s`, 'ok')
    poll.iniciar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* El broadcast de la Lambda llega como ARRAY de lecturas (envío por lotes),
     no de una en una, y cada elemento puede ser métricas o alerta. */
  const recibirLote = useCallback(
    (payload: unknown) => {
      const lote = Array.isArray(payload) ? payload : [payload]
      for (const ev of lote) {
        if (!ev || typeof ev !== 'object') continue
        const o = ev as Record<string, unknown>
        if (o.tipo === 'metricas' || 'embudo' in o || 'productosMasVistos' in o) setMetricas(o as unknown as Metricas)
        else if (o.tipo === 'alerta' || 'bloqueosActivos' in o) setAlertas(o as unknown as ResumenAlertas)
        else log(`evento de tipo desconocido: ${JSON.stringify(o).slice(0, 90)}`)
      }
    },
    [log],
  )

  const ws = useWebSocket({ onMensaje: recibirLote, onAviso: log })

  const detener = useCallback(() => {
    poll.detener()
    ws.desconectar()
    ultimoError.current = {}
    setFuente('nada')
  }, [poll, ws])

  /* Cuando el ciclo se rinde solo, la pantalla tiene que dejar de anunciar
     "lectura directa activa". */
  useEffect(() => {
    if (poll.rendido) setFuente('nada')
  }, [poll.rendido])

  function alternarPoll() {
    if (fuente === 'poll') {
      poll.detener()
      setFuente('nada')
      log('lectura periódica detenida')
      return
    }
    ws.desconectar()
    ultimoError.current = {}
    setFuente('poll')
    log(`leyendo de los servicios cada ${INTERVALO_MS / 1000} s`, 'ok')
    poll.iniciar()
  }

  function conectar() {
    const destino = url.trim()
    /* El navegador conecta con wss://; la Lambda usa https:// contra el mismo
       endpoint para postToConnection. Son dos esquemas de la misma API. */
    if (!/^wss?:\/\//.test(destino)) {
      log('la URL debe empezar con wss:// (o ws:// en pruebas locales)', 'error')
      return
    }
    poll.detener()
    setFuente('ws')
    ws.conectar(destino)
  }

  /* El hook reconecta solo; la pantalla sólo deja de anunciar la fuente cuando
     se rindió del todo. */
  useEffect(() => {
    if (ws.estado === 'rendido' || ws.estado === 'cerrado') {
      setFuente((f) => (f === 'ws' ? 'nada' : f))
    }
  }, [ws.estado])

  /* topProductos es el campo nuevo; productosMasVistos queda como respaldo. */
  const topProductos = metricas?.topProductos ?? metricas?.productosMasVistos ?? []
  const maxVistas = topProductos.length > 0 ? Math.max(...topProductos.map((v) => v.vistas)) : 0

  const embudo = metricas?.embudo
  const maxEmbudo = embudo ? Math.max(embudo.vistas, embudo.carritos, embudo.compras) : 0

  const serie = useMemo(() => (metricas?.serieMinutos ?? []).slice(-VENTANA_MINUTOS), [metricas])
  const maxSerie = serie.length > 0 ? Math.max(...serie.map((s) => s.interacciones)) : 0

  const porTipo = Object.entries(metricas?.porTipo ?? {})
  const maxPorTipo = porTipo.length > 0 ? Math.max(...porTipo.map(([, v]) => v)) : 0

  const etiquetaFuente =
    fuente === 'ws'
      ? ws.estado === 'conectado'
        ? 'WebSocket conectado'
        : ws.estado === 'reconectando'
          ? `reconectando (intento ${ws.intentos})`
          : 'conectando…'
      : fuente === 'poll'
        ? poll.fallos > 0
          ? `reintentando cada ${describirEspera(poll.esperaMs)}`
          : `lectura directa cada ${describirEspera(poll.esperaMs)}`
        : 'sin fuente de datos'

  const estadoFuente =
    fuente === 'nada'
      ? 'bad'
      : (fuente === 'ws' && ws.estado !== 'conectado') || poll.fallos > 0
        ? 'warn'
        : 'ok'

  return (
    <div className="stack">
      <PageHeader
        titulo="Operaciones en tiempo real"
        bajada="Pulso de la tienda: qué se mira, cuánto se mueve y qué se bloquea. Se lee de los microservicios cada 5 s o llega empujado por API Gateway."
        accion={<Badge estado={estadoFuente}>{etiquetaFuente}</Badge>}
      />

      {ws.estado === 'rendido' && (
        <Notice estado="bad" titulo="Se dejó de reconectar el WebSocket">
          El endpoint no aceptó la conexión después de varios reintentos. Si la infraestructura se recreó, la URL de
          API Gateway cambió: tomá la nueva de la salida <code>url_websocket</code> de Terraform. Mientras tanto,{' '}
          <b>Leer de los servicios</b> da los mismos datos sin AWS.
        </Notice>
      )}

      {poll.rendido && (
        <Notice estado="bad" titulo="Lectura automática detenida">
          Los servicios no respondieron {poll.fallos} veces seguidas, así que se cortó el ciclo en lugar de seguir
          insistiendo. Revisá que <code>:8083</code> y <code>:8084</code> estén arriba y volvé a pulsar{' '}
          <b>Leer de los servicios</b>.
        </Notice>
      )}

      <Card
        titulo="Fuente de datos"
        descripcion="El endpoint de API Gateway cambia cada vez que se recrea la infraestructura, por eso no está fijo en el código."
      >
        <div className="row">
          <div className="grow" style={{ minWidth: 280 }}>
            <Field etiqueta="Endpoint WebSocket">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="wss://xxxx.execute-api.us-east-1.amazonaws.com/production"
              />
            </Field>
          </div>
          <Button variante="primario" onClick={conectar} disabled={fuente === 'ws'}>
            Conectar
          </Button>
          <Button onClick={detener} disabled={fuente === 'nada'}>
            Desconectar
          </Button>
          <Button onClick={alternarPoll}>{fuente === 'poll' ? 'Detener lectura' : 'Leer de los servicios'}</Button>
        </div>
      </Card>

      <div className="metrics">
        <Metric etiqueta="Interacciones por minuto" valor={num(metricas?.interaccionesPorMinuto)} />
        <Metric etiqueta="Usuarios activos" valor={num(metricas?.usuariosActivos)} sufijo="5 min" />
        <Metric etiqueta="Interacciones totales" valor={num(metricas?.totalInteracciones)} />
        <Metric
          etiqueta="Bloqueos de fraude"
          valor={alertas?.bloqueosActivos ?? '—'}
          estado={alertas && alertas.bloqueosActivos > 0 ? 'bad' : undefined}
        />
      </div>

      <div className="grid-2">
        <Card titulo="Embudo" descripcion="Vistas → carritos → compras, de GET /api/metricas.">
          {!embudo ? (
            <Empty>Sin datos. Leé de los servicios o conectá el WebSocket.</Empty>
          ) : (
            <Table cols={['Etapa', { t: 'Cantidad', num: true }, '']}>
              {(
                [
                  ['Vistas', embudo.vistas],
                  ['Carritos', embudo.carritos],
                  ['Compras', embudo.compras],
                ] as const
              ).map(([etapa, cantidad]) => (
                <tr key={etapa}>
                  <td>{etapa}</td>
                  <td className="num">{num(cantidad)}</td>
                  <td style={{ width: '50%' }}>
                    <Bar valor={cantidad} max={maxEmbudo} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card titulo="Interacciones por minuto" descripcion={`Últimos ${VENTANA_MINUTOS} minutos, de serieMinutos.`}>
          {serie.length === 0 ? (
            <Empty>Sin actividad registrada todavía.</Empty>
          ) : (
            <Table cols={['Minuto', { t: 'Interacciones', num: true }, '']}>
              {serie.map((s) => (
                <tr key={s.inicio}>
                  <td className="mono">{hora(s.inicio)}</td>
                  <td className="num">{num(s.interacciones)}</td>
                  <td style={{ width: '50%' }}>
                    <Bar valor={s.interacciones} max={maxSerie} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card titulo="Top de productos" descripcion="topProductos: agregado por el consumidor de interacciones-user.">
          {topProductos.length === 0 ? (
            <Empty>Sin datos. Conectá el WebSocket o leé de los servicios.</Empty>
          ) : (
            <Table cols={['Producto', 'Categoría', { t: 'Interacciones', num: true }, '']}>
              {topProductos.map((p) => (
                <tr key={p.itemId}>
                  <td>
                    <strong style={{ fontWeight: 510, color: 'var(--ink)' }}>{p.nombre || p.itemId}</strong>
                  </td>
                  <td>{p.categoria || '—'}</td>
                  <td className="num">{num(p.vistas)}</td>
                  <td style={{ width: 90 }}>
                    <Bar valor={p.vistas} max={maxVistas} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card titulo="Por tipo de interacción" descripcion="porTipo: conteo por acción registrada.">
          {porTipo.length === 0 ? (
            <Empty>Sin interacciones registradas.</Empty>
          ) : (
            <Table cols={['Tipo', { t: 'Cantidad', num: true }, '']}>
              {porTipo.map(([tipo, cantidad]) => (
                <tr key={tipo}>
                  <td className="mono">{tipo}</td>
                  <td className="num">{num(cantidad)}</td>
                  <td style={{ width: '50%' }}>
                    <Bar valor={cantidad} max={maxPorTipo} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <Card titulo="Alertas de fraude" descripcion="Tarjetas bloqueadas por la regla de velocidad de intentos (GET /api/alertas).">
        {!alertas || alertas.alertas.length === 0 ? (
          <Empty>Sin bloqueos vigentes.</Empty>
        ) : (
          <Table cols={['Tarjeta', 'Cliente', { t: 'Intentos', num: true }, { t: 'Expira en', num: true }, 'Detectado']}>
            {alertas.alertas.map((a) => (
              <tr key={`${a.huellaTarjeta ?? ''}-${a.idCliente}`}>
                <td className="mono">{a.ultimos4 ? `****${a.ultimos4}` : (a.huellaTarjeta ?? '—')}</td>
                <td className="mono">{a.idCliente}</td>
                <td className="num">{a.cantidadIntentos}</td>
                <td className="num">{a.minutosRestantes > 0 ? `${a.minutosRestantes} min` : '—'}</td>
                <td className="mono muted">{fechaHora(a.actualizadoEn)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <LogPanel lineas={lineas} onLimpiar={limpiar} />
    </div>
  )
}
