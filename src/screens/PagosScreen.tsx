import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '../components/Shell'
import { LogPanel } from '../components/LogPanel'
import { Badge, Button, Card, Empty, Field, Input, Metric, Notice, Table } from '../components/ui'
import { useLog } from '../hooks/useLog'
import { pagos } from '../lib/api'
import { fechaHora } from '../lib/format'
import type { AlertaFraude, PeticionPago, ResumenAlertas } from '../lib/types'

type Aviso = { estado: 'ok' | 'bad' | 'warn'; titulo: string; detalle?: React.ReactNode }

/* Tarjetas de prueba del ambiente de integración de Transbank. Sin dinero real. */
const TARJETAS_PRUEBA = [
  { marca: 'VISA', numero: '4051 8856 0044 6623', cvv: '123', aprueba: true },
  { marca: 'MASTERCARD', numero: '5186 0595 5959 0568', cvv: '123', aprueba: false },
]

/* Transbank EXIGE POST con token_ws en un formulario: un redirect GET a la URL
   de Webpay se rechaza. Se navega en la MISMA pestaña para que la vuelta caiga
   en /callback de esta app y no en una pestaña huérfana. */
function irAWebpay(url: string, token: string) {
  const form = document.createElement('form')
  form.action = url
  form.method = 'POST'
  const campo = document.createElement('input')
  campo.type = 'hidden'
  campo.name = 'token_ws'
  campo.value = token
  form.appendChild(campo)
  document.body.appendChild(form)
  form.submit()
}

export function PagosScreen() {
  const [cliente, setCliente] = useState('ismael')
  const [monto, setMonto] = useState('15000')
  /* Modo simulado: mismo endpoint, pero el número de tarjeta viaja en el cuerpo.
     Es lo que hace que el antifraude cuente por tarjeta en la demostración. */
  const [pasarela, setPasarela] = useState<'webpay' | 'simulada'>('simulada')
  const [tarjeta, setTarjeta] = useState('4111111111111111')
  const [enviando, setEnviando] = useState(false)
  const [rafagaEnCurso, setRafagaEnCurso] = useState(false)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [resumen, setResumen] = useState<ResumenAlertas | null>(null)
  const { lineas, log, limpiar } = useLog()

  const simulada = pasarela === 'simulada'

  const cargarAlertas = useCallback(async () => {
    try {
      setResumen(await pagos.alertas())
    } catch {
      /* el panel de alertas es informativo: si falla, no bloquea la pantalla */
    }
  }, [])

  useEffect(() => {
    void cargarAlertas()
    const t = setInterval(() => void cargarAlertas(), 15000)
    return () => clearInterval(t)
  }, [cargarAlertas])

  const bloqueadoEsteCliente = resumen?.alertas.find(
    (a) => a.idCliente === cliente.trim() && a.minutosRestantes > 0,
  )

  /* Arma el cuerpo: en modo simulado se agrega la tarjeta; en Webpay no. */
  function armarPeticion(clientId: string, amount: number, transactionId: string): PeticionPago {
    const peticion: PeticionPago = { clientId, amount, transactionId }
    if (simulada) peticion.tarjeta = tarjeta.trim()
    return peticion
  }

  async function pagar() {
    const cli = cliente.trim()
    const importe = Number(monto)
    if (!cli) {
      setAviso({ estado: 'bad', titulo: 'Falta el cliente', detalle: 'El campo clientId no puede ir vacío.' })
      return
    }
    if (!Number.isFinite(importe) || importe <= 0) {
      setAviso({ estado: 'bad', titulo: 'Monto inválido', detalle: 'El backend valida @Positive: debe ser mayor que 0.' })
      return
    }
    if (simulada && !tarjeta.trim()) {
      setAviso({ estado: 'bad', titulo: 'Falta la tarjeta', detalle: 'En modo simulado el número de tarjeta es obligatorio.' })
      return
    }

    const tx = `TX-${Date.now()}`
    setEnviando(true)
    setAviso(null)
    log(`POST /api/pagos/iniciar  cliente=${cli} monto=${importe} tx=${tx} modo=${pasarela}`)

    try {
      const { status, body } = await pagos.iniciar(armarPeticion(cli, importe, tx))

      if (status === 429) {
        setAviso({ estado: 'bad', titulo: 'Bloqueado por el antifraude', detalle: body.message })
        log('HTTP 429 — bloqueado por más de 3 intentos con la misma tarjeta', 'error')
        void cargarAlertas()
      } else if (status === 400) {
        setAviso({
          estado: 'bad',
          titulo: 'Datos inválidos',
          detalle: 'Spring rechazó la petición: clientId no puede estar vacío y amount debe ser mayor que 0.',
        })
        log('HTTP 400 — validación de entrada', 'error')
      } else if (body.url && body.token) {
        setAviso({
          estado: 'ok',
          titulo: 'Transacción creada en Transbank',
          detalle: (
            <>
              Token <code>{body.token.slice(0, 28)}…</code> — redirigiendo a Webpay por POST.
            </>
          ),
        })
        log('HTTP 200 — token recibido, redirigiendo a Webpay', 'ok')
        irAWebpay(body.url, body.token)
      } else {
        setAviso({
          estado: 'bad',
          titulo: `Respuesta inesperada (HTTP ${status})`,
          detalle: <code>{JSON.stringify(body).slice(0, 220)}</code>,
        })
        log(`HTTP ${status} — respuesta sin url/token`, 'error')
      }
    } catch (e) {
      setAviso({
        estado: 'bad',
        titulo: 'El servicio de pagos no responde',
        detalle: <>Revisá que ms-pago esté arriba en <code>:8083</code> y que el origen esté en CORS_ORIGENES.</>,
      })
      log(`error de red: ${(e as Error).message}`, 'error')
    } finally {
      setEnviando(false)
    }
  }

  /* La ráfaga es la prueba de la regla antifraude: más de 3 intentos con la
     misma tarjeta en menos de 10 s deben devolver 429 y bloquearla 30 minutos. */
  async function rafaga() {
    const cli = cliente.trim() || 'ismael'
    const importe = Number(monto) || 1000
    if (simulada && !tarjeta.trim()) {
      setAviso({ estado: 'bad', titulo: 'Falta la tarjeta', detalle: 'En modo simulado la ráfaga necesita una tarjeta.' })
      return
    }
    setRafagaEnCurso(true)
    setAviso(null)
    log(`ráfaga de 4 intentos con la misma tarjeta (cliente ${cli}, modo ${pasarela})`)

    const codigos: (number | 'err')[] = []
    for (let i = 1; i <= 4; i++) {
      try {
        const { status } = await pagos.iniciar(armarPeticion(cli, importe, `TXB-${Date.now()}-${i}`))
        codigos.push(status)
        log(`intento ${i} → HTTP ${status}`, status === 429 ? 'error' : 'ok')
      } catch {
        codigos.push('err')
        log(`intento ${i} → error de red`, 'error')
      }
    }

    const bloqueo = codigos.includes(429)
    setAviso({
      estado: bloqueo ? 'ok' : 'warn',
      titulo: `Resultado de la ráfaga: ${codigos.join(' · ')}`,
      detalle: bloqueo
        ? 'El antifraude bloqueó la tarjeta, que es el comportamiento esperado.'
        : 'No hubo bloqueo. Revisá que el consumidor del tópico payment-attempts esté procesando.',
    })
    setRafagaEnCurso(false)
    void cargarAlertas()
  }

  async function resetAlertas() {
    try {
      const msg = await pagos.resetAlertas()
      log(`DELETE /api/alertas → ${msg}`, 'ok')
      setAviso({ estado: 'ok', titulo: 'Antifraude reseteado', detalle: msg })
      void cargarAlertas()
    } catch (e) {
      log(`error al resetear: ${(e as Error).message}`, 'error')
    }
  }

  return (
    <div className="stack">
      <PageHeader
        titulo="Pagos"
        bajada="Webpay Plus sobre Transbank, con detección de fraude por velocidad de intentos sobre la tarjeta. Cada intento se publica en el tópico payment-attempts."
        accion={
          bloqueadoEsteCliente ? (
            <Badge estado="bad">cliente bloqueado · {bloqueadoEsteCliente.minutosRestantes} min</Badge>
          ) : (
            <Badge estado="ok">cliente habilitado</Badge>
          )
        }
      />

      <div className="metrics">
        <Metric
          etiqueta="Bloqueos vigentes"
          valor={resumen?.bloqueosActivos ?? '—'}
          estado={resumen && resumen.bloqueosActivos > 0 ? 'bad' : undefined}
        />
        <Metric etiqueta="Clientes vigilados" valor={resumen?.totalClientesVigilados ?? '—'} />
        <Metric etiqueta="Umbral por tarjeta" valor=">3" sufijo="intentos / 10 s" nota="bloqueo de 30 minutos" />
      </div>

      <Card
        titulo="Iniciar un pago"
        descripcion="El antifraude cuenta por tarjeta: con tarjetas distintas el contador arranca de cero."
      >
        <div className="row" style={{ marginBottom: 'var(--s4)', alignItems: 'center' }}>
          <Button
            variante={simulada ? 'primario' : 'ghost'}
            onClick={() => setPasarela('simulada')}
            aria-pressed={simulada}
          >
            Simulada
          </Button>
          <Button variante={simulada ? 'ghost' : 'primario'} onClick={() => setPasarela('webpay')} aria-pressed={!simulada}>
            Webpay
          </Button>
          <span className="muted">
            {simulada
              ? 'Envía el número de tarjeta junto con el pago.'
              : 'Sin tarjeta en el cuerpo: Transbank pide los datos en su formulario.'}
          </span>
        </div>
        <div className="row">
          <Field etiqueta="clientId" ancho={200}>
            <Input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="ismael" />
          </Field>
          <Field etiqueta="Monto (CLP)" ancho={160}>
            <Input type="number" min={1} value={monto} onChange={(e) => setMonto(e.target.value)} />
          </Field>
          {simulada && (
            <Field etiqueta="Tarjeta" ancho={220}>
              <Input value={tarjeta} onChange={(e) => setTarjeta(e.target.value)} placeholder="4111111111111111" />
            </Field>
          )}
          <Button variante="primario" onClick={pagar} disabled={enviando || rafagaEnCurso}>
            {enviando ? 'Verificando…' : simulada ? 'Pagar (simulado)' : 'Pagar con Webpay'}
          </Button>
          <Button onClick={rafaga} disabled={enviando || rafagaEnCurso}>
            {rafagaEnCurso ? 'Enviando ráfaga…' : 'Ráfaga de 4 (probar bloqueo)'}
          </Button>
          <Button variante="peligro" onClick={resetAlertas} disabled={enviando || rafagaEnCurso}>
            Reset antifraude
          </Button>
        </div>

        {aviso && (
          <div style={{ marginTop: 'var(--s4)' }}>
            <Notice estado={aviso.estado} titulo={aviso.titulo} onCerrar={() => setAviso(null)}>
              {aviso.detalle}
            </Notice>
          </div>
        )}
      </Card>

      <div className="grid-2">
        <Card titulo="Tarjetas del ambiente de integración" descripcion="Sin dinero real. RUT 11.111.111-1, clave 123, cualquier fecha futura.">
          <Table cols={['Tarjeta', 'Número', 'CVV', 'Resultado']}>
            {TARJETAS_PRUEBA.map((t) => (
              <tr key={t.numero}>
                <td>{t.marca}</td>
                <td className="mono">{t.numero}</td>
                <td className="mono">{t.cvv}</td>
                <td>
                  <Badge estado={t.aprueba ? 'ok' : 'bad'}>{t.aprueba ? 'aprobada' : 'rechazada'}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card titulo="Bloqueos vigentes" descripcion="GET /api/alertas, refrescado cada 15 s.">
          {!resumen || resumen.alertas.length === 0 ? (
            <Empty>Ningún cliente bloqueado en este momento.</Empty>
          ) : (
            <Table cols={['Tarjeta', 'Cliente', { t: 'Intentos', num: true }, { t: 'Expira en', num: true }, 'Detectado']}>
              {resumen.alertas.map((a: AlertaFraude) => (
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
      </div>

      <LogPanel lineas={lineas} onLimpiar={limpiar} />
    </div>
  )
}
