import { useCallback, useEffect, useState } from 'react'
import { LogPanel } from '../components/LogPanel'
import { PageHeader } from '../components/Shell'
import { Badge, Bar, Button, Card, Empty, Field, Input, Metric, Notice, Spinner, Table } from '../components/ui'
import { useLog } from '../hooks/useLog'
import { notificaciones, rabbit } from '../lib/api'
import { fechaHora, num } from '../lib/format'
import type {
  NotificacionFallida,
  RabbitBinding,
  RabbitCluster,
  RabbitCola,
  RabbitExchange,
} from '../lib/types'

/* Lo que el propio broker o la topología de la demo necesitan: borrarlo rompe el
   flujo de pagos o de recomendaciones, así que el botón no se ofrece. El backend
   ya marca `protegida`; esta lista cubre el caso en que la marca no llegue. */
const COLAS_PROTEGIDAS = new Set(['payment-attempts', 'interacciones-user'])

const esProtegida = (c: RabbitCola) => c.protegida || COLAS_PROTEGIDAS.has(c.nombre)

const estadoCola = (estado: string) => {
  const e = estado.toLowerCase()
  if (e === 'running' || e === 'idle') return 'ok' as const
  if (e === 'down' || e === 'unavailable') return 'bad' as const
  return 'warn' as const
}

const bytes = (n: number | null | undefined) => {
  if (n == null) return '—'
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

const duracion = (ms: number | null | undefined) => {
  if (ms == null) return '—'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}

export function RabbitScreen() {
  const [cluster, setCluster] = useState<RabbitCluster | null>(null)
  const [colas, setColas] = useState<RabbitCola[] | null>(null)
  const [exchanges, setExchanges] = useState<RabbitExchange[] | null>(null)
  const [bindings, setBindings] = useState<RabbitBinding[] | null>(null)
  const [fallidas, setFallidas] = useState<NotificacionFallida[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const { lineas, log, limpiar } = useLog()

  /* formulario de creación de cola */
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState('classic')
  const [durable, setDurable] = useState(true)
  const [creando, setCreando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const [c, q, x, b, f] = await Promise.allSettled([
      rabbit.cluster(),
      rabbit.colas(),
      rabbit.exchanges(),
      rabbit.bindings(),
      notificaciones.fallidas(),
    ])

    if (c.status === 'fulfilled') {
      setCluster(c.value)
      log(`GET /api/rabbit/cluster → ${c.value.nodosCorriendo}/${c.value.totalNodos} nodos`, 'ok')
    } else log(`cluster: ${(c.reason as Error).message}`, 'error')

    if (q.status === 'fulfilled') {
      setColas(q.value)
      log(`GET /api/rabbit/colas → ${q.value.length} cola(s)`, 'ok')
    } else log(`colas: ${(q.reason as Error).message}`, 'error')

    if (x.status === 'fulfilled') {
      setExchanges(x.value)
      log(`GET /api/rabbit/exchanges → ${x.value.length} exchange(s)`, 'ok')
    } else log(`exchanges: ${(x.reason as Error).message}`, 'error')

    if (b.status === 'fulfilled') {
      setBindings(b.value)
      log(`GET /api/rabbit/bindings → ${b.value.length} binding(s)`, 'ok')
    } else log(`bindings: ${(b.reason as Error).message}`, 'error')

    if (f.status === 'fulfilled') {
      setFallidas(f.value)
      log(`GET /api/notificaciones/fallidas → ${f.value.length} mensaje(s)`, f.value.length > 0 ? 'info' : 'ok')
    } else log(`notificaciones: ${(f.reason as Error).message}`, 'error')

    setCargando(false)
  }, [log])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function crear() {
    const n = nombre.trim()
    if (!n) {
      setError('El nombre de la cola es obligatorio.')
      return
    }
    setCreando(true)
    setError(null)
    setOk(null)
    try {
      await rabbit.crearCola({ nombre: n, tipo, durable })
      setOk(`Cola ${n} creada (${tipo}, ${durable ? 'durable' : 'transitoria'}).`)
      log(`POST /api/rabbit/colas  ${n} (tipo=${tipo}, durable=${durable})`, 'ok')
      setNombre('')
      await cargar()
    } catch (e) {
      setError((e as Error).message)
      log(`error al crear ${n}: ${(e as Error).message}`, 'error')
    } finally {
      setCreando(false)
    }
  }

  async function eliminar(cola: string) {
    if (!window.confirm(`¿Eliminar la cola ${cola}? Los mensajes que tenga se pierden.`)) return
    setError(null)
    setOk(null)
    try {
      await rabbit.eliminarCola(cola)
      setOk(`Cola ${cola} eliminada.`)
      log(`DELETE /api/rabbit/colas/${cola}`, 'ok')
      await cargar()
    } catch (e) {
      setError((e as Error).message)
      log(`error al eliminar ${cola}: ${(e as Error).message}`, 'error')
    }
  }

  const maxMensajes = colas && colas.length > 0 ? Math.max(...colas.map((c) => c.mensajes)) : 0

  return (
    <div className="stack">
      <PageHeader
        titulo="RabbitMQ"
        bajada="Clúster de RabbitMQ con quórum: colas, exchanges y bindings del broker, más la cola de mensajes fallidos (DLQ) de ms-notificaciones."
        accion={
          <Button onClick={() => void cargar()} disabled={cargando}>
            {cargando ? <Spinner /> : null}
            Refrescar
          </Button>
        }
      />

      {error && (
        <Notice estado="bad" titulo="Error del administrador de RabbitMQ" onCerrar={() => setError(null)}>
          {error} — revisá que ms-rabbit-admin esté arriba en <code>:8089</code>.
        </Notice>
      )}
      {ok && (
        <Notice estado="ok" titulo="Operación aplicada" onCerrar={() => setOk(null)}>
          {ok}
        </Notice>
      )}

      {/* ---------- clúster ---------- */}
      <div className="metrics">
        <Metric
          etiqueta="Nodos corriendo"
          valor={cluster ? `${cluster.nodosCorriendo}/${cluster.totalNodos}` : '—'}
          estado={cluster && cluster.nodosCorriendo < cluster.totalNodos ? 'bad' : undefined}
        />
        <Metric
          etiqueta="Quórum"
          valor={cluster ? (cluster.hayQuorum ? 'sí' : 'no') : '—'}
          estado={cluster && !cluster.hayQuorum ? 'bad' : undefined}
        />
        <Metric
          etiqueta="Particiones de red"
          valor={cluster ? (cluster.hayParticiones ? 'sí' : 'no') : '—'}
          estado={cluster && cluster.hayParticiones ? 'bad' : undefined}
        />
        <Metric
          etiqueta="Alarmas"
          valor={cluster ? (cluster.hayAlarmas ? 'activas' : 'ninguna') : '—'}
          estado={cluster && cluster.hayAlarmas ? 'warn' : undefined}
          nota={cluster ? `fuente: ${cluster.fuente}` : undefined}
        />
      </div>

      <Card titulo="Nodos" descripcion="GET /api/rabbit/cluster">
        {!cluster ? (
          <Empty>{cargando ? 'Consultando el clúster…' : 'Sin datos del clúster.'}</Empty>
        ) : (
          <Table
            cols={[
              'Nodo',
              'Estado',
              { t: 'Memoria', num: true },
              { t: 'Disco libre', num: true },
              { t: 'Uptime', num: true },
              'Alarmas',
            ]}
          >
            {cluster.nodos.map((n) => (
              <tr key={n.nombre}>
                <td className="mono">{n.nombre}</td>
                <td>
                  <Badge estado={n.corriendo ? 'ok' : 'bad'}>{n.corriendo ? 'corriendo' : 'caído'}</Badge>
                </td>
                <td className="num">
                  {n.porcentajeMemoria != null ? `${n.porcentajeMemoria.toFixed(0)}% · ` : ''}
                  {bytes(n.memoriaUsadaBytes)} / {bytes(n.memoriaLimiteBytes)}
                </td>
                <td className="num">{bytes(n.discoLibreBytes)}</td>
                <td className="num">{duracion(n.uptimeMs)}</td>
                <td>
                  {n.alarmaMemoria || n.alarmaDisco ? (
                    <Badge estado="warn">
                      {[n.alarmaMemoria && 'memoria', n.alarmaDisco && 'disco'].filter(Boolean).join(' · ')}
                    </Badge>
                  ) : (
                    <Badge estado="ok">ninguna</Badge>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ---------- colas ---------- */}
      <Card titulo="Colas" descripcion="GET /api/rabbit/colas. Las protegidas no ofrecen eliminar.">
        {!colas ? (
          <Empty>{cargando ? 'Consultando las colas…' : 'Sin datos de colas.'}</Empty>
        ) : colas.length === 0 ? (
          <Empty>No hay colas en el broker.</Empty>
        ) : (
          <Table
            cols={[
              'Cola',
              'Tipo',
              { t: 'Mensajes', num: true },
              { t: 'Listos', num: true },
              { t: 'Sin confirmar', num: true },
              { t: 'Consumidores', num: true },
              'Estado',
              '',
            ]}
          >
            {colas.map((c) => (
              <tr key={c.nombre}>
                <td>
                  <strong style={{ fontWeight: 510, color: 'var(--ink)' }}>{c.nombre}</strong>
                  <small className="mono muted" style={{ display: 'block' }}>
                    {c.durable ? 'durable' : 'transitoria'}
                    {c.nodo ? ` · ${c.nodo}` : ''}
                  </small>
                </td>
                <td>{c.tipo}</td>
                <td className="num">
                  {num(c.mensajes)}
                  <Bar valor={c.mensajes} max={maxMensajes} />
                </td>
                <td className="num">{num(c.mensajesListos)}</td>
                <td className="num">{num(c.mensajesSinConfirmar)}</td>
                <td className="num">{num(c.consumidores)}</td>
                <td>
                  <Badge estado={estadoCola(c.estado)}>{c.estado}</Badge>
                </td>
                <td className="num">
                  {esProtegida(c) ? (
                    <Badge>protegida</Badge>
                  ) : (
                    <Button variante="peligro" onClick={() => void eliminar(c.nombre)}>
                      Eliminar
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card titulo="Crear una cola" descripcion="POST /api/rabbit/colas">
        <div className="row">
          <Field etiqueta="Nombre" ancho={240}>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="cola-demo" />
          </Field>
          <Field etiqueta="Tipo" ancho={160}>
            <Input value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="classic" />
          </Field>
          <label className="field" style={{ flex: 'none', justifyContent: 'flex-end' }}>
            <span className="field__label">Durable</span>
            <input type="checkbox" checked={durable} onChange={(e) => setDurable(e.target.checked)} />
          </label>
          <Button variante="primario" onClick={() => void crear()} disabled={creando}>
            {creando ? <Spinner /> : null}
            Crear cola
          </Button>
        </div>
      </Card>

      {/* ---------- exchanges y bindings ---------- */}
      <div className="grid-2">
        <Card titulo="Exchanges" descripcion="GET /api/rabbit/exchanges">
          {!exchanges ? (
            <Empty>{cargando ? 'Consultando…' : 'Sin datos.'}</Empty>
          ) : exchanges.length === 0 ? (
            <Empty>No hay exchanges.</Empty>
          ) : (
            <Table cols={['Exchange', 'Tipo', 'Opciones']}>
              {exchanges.map((x) => (
                <tr key={x.nombre || '(default)'}>
                  <td className="mono">{x.nombre || '(por defecto)'}</td>
                  <td>{x.tipo}</td>
                  <td>
                    <span className="muted">
                      {[x.durable && 'durable', x.interno && 'interno', x.protegido && 'protegido']
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card titulo="Bindings" descripcion="GET /api/rabbit/bindings">
          {!bindings ? (
            <Empty>{cargando ? 'Consultando…' : 'Sin datos.'}</Empty>
          ) : bindings.length === 0 ? (
            <Empty>No hay bindings.</Empty>
          ) : (
            <Table cols={['Origen', 'Destino', 'Routing key']}>
              {bindings.map((b) => (
                <tr key={b.propertiesKey || `${b.origen}-${b.destino}-${b.routingKey}`}>
                  <td className="mono">{b.origen || '(por defecto)'}</td>
                  <td className="mono">
                    {b.destino} <small className="muted">({b.tipoDestino})</small>
                  </td>
                  <td className="mono">{b.routingKey || '—'}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {/* ---------- DLQ ---------- */}
      <Card
        titulo="Mensajes fallidos (DLQ)"
        descripcion="GET ms-notificaciones /api/notificaciones/fallidas. Mensajes que el consumidor no pudo procesar."
        accion={fallidas ? <Badge estado={fallidas.length > 0 ? 'bad' : 'ok'}>{fallidas.length}</Badge> : null}
      >
        {!fallidas ? (
          <Empty>{cargando ? 'Consultando…' : 'ms-notificaciones no respondió.'}</Empty>
        ) : fallidas.length === 0 ? (
          <Empty>Ningún mensaje fallido.</Empty>
        ) : (
          <Table
            cols={[
              { t: 'ID', num: true },
              'Cola de origen',
              'Motivo',
              { t: 'Veces', num: true },
              'Recibido',
            ]}
          >
            {fallidas.map((f) => (
              <tr key={f.id}>
                <td className="num">{f.id}</td>
                <td className="mono">{f.colaOrigen}</td>
                <td>{f.motivo}</td>
                <td className="num">{f.conteo}</td>
                <td className="mono muted">{fechaHora(f.recibidoEn)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <LogPanel lineas={lineas} onLimpiar={limpiar} />
    </div>
  )
}
