import { useCallback, useEffect, useState } from 'react'
import { LogPanel } from '../components/LogPanel'
import { PageHeader } from '../components/Shell'
import { Badge, Button, Card, Empty, Field, Input, Metric, Notice, Spinner, Table } from '../components/ui'
import { useLog } from '../hooks/useLog'
import { admin } from '../lib/api'
import { num } from '../lib/format'
import type { Cluster, ConsumerGroup, ConsumerGroupLag, Topico, TopicoDetalle } from '../lib/types'

/* Un tópico creado por la demo no debería borrar los dos del enunciado por un
   clic distraído, así que los de producción no ofrecen el botón de eliminar. */
const TOPICOS_PROTEGIDOS = new Set(['payment-attempts', 'interacciones-user'])

const estadoDeGrupo = (estado: string) => {
  const e = estado.toUpperCase()
  if (e === 'STABLE') return 'ok' as const
  if (e === 'EMPTY' || e === 'DEAD') return 'bad' as const
  return 'warn' as const
}

export function KafkaScreen() {
  const [cluster, setCluster] = useState<Cluster | null>(null)
  const [topicos, setTopicos] = useState<Topico[] | null>(null)
  const [grupos, setGrupos] = useState<ConsumerGroup[] | null>(null)
  const [detalle, setDetalle] = useState<TopicoDetalle | null>(null)
  const [lag, setLag] = useState<ConsumerGroupLag | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const { lineas, log, limpiar } = useLog()

  /* formulario de creación */
  const [nombre, setNombre] = useState('')
  const [particiones, setParticiones] = useState('3')
  const [replicas, setReplicas] = useState('3')
  const [creando, setCreando] = useState(false)

  /* edición del tópico con detalle abierto */
  const [cfgForm, setCfgForm] = useState({ retentionMs: '', cleanupPolicy: '', minInsyncReplicas: '' })
  const [guardandoCfg, setGuardandoCfg] = useState(false)
  const [nuevasParticiones, setNuevasParticiones] = useState('')

  /* reset de offsets desde el desfase abierto */
  const [topicoReset, setTopicoReset] = useState('')
  const [reseteando, setReseteando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    const [c, t, g] = await Promise.allSettled([admin.cluster(), admin.topicos(), admin.consumerGroups()])

    if (c.status === 'fulfilled') {
      setCluster(c.value)
      log(`GET /api/cluster → ${c.value.cantidadBrokers} brokers, controlador ${c.value.controlador}`, 'ok')
    } else {
      setError((c.reason as Error).message)
      log(`cluster: ${(c.reason as Error).message}`, 'error')
    }

    if (t.status === 'fulfilled') {
      setTopicos(t.value)
      log(`GET /api/topicos → ${t.value.length} tópico(s)`, 'ok')
    } else log(`topicos: ${(t.reason as Error).message}`, 'error')

    if (g.status === 'fulfilled') {
      setGrupos(g.value)
      log(`GET /api/consumer-groups → ${g.value.length} grupo(s)`, 'ok')
    } else log(`consumer-groups: ${(g.reason as Error).message}`, 'error')

    setCargando(false)
  }, [log])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function verDetalle(nombreTopico: string) {
    setDetalle(null)
    try {
      const d = await admin.topico(nombreTopico)
      setDetalle(d)
      setCfgForm({
        retentionMs: d.configuracion?.retentionMs ?? '',
        cleanupPolicy: d.configuracion?.cleanupPolicy ?? '',
        minInsyncReplicas: d.configuracion?.minInsyncReplicas ?? '',
      })
      setNuevasParticiones(String(d.particiones + 1))
      log(`GET /api/topicos/${nombreTopico} → ${d.particionesDetalle?.length ?? 0} partición(es)`, 'ok')
    } catch (e) {
      setError((e as Error).message)
      log(`detalle de ${nombreTopico}: ${(e as Error).message}`, 'error')
    }
  }

  async function verLag(grupo: string) {
    setLag(null)
    try {
      const l = await admin.lag(grupo)
      setLag(l)
      log(`GET /api/consumer-groups/${grupo}/lag → lag total ${l.lagTotal}`, l.lagTotal > 0 ? 'info' : 'ok')
    } catch (e) {
      setError((e as Error).message)
      log(`lag de ${grupo}: ${(e as Error).message}`, 'error')
    }
  }

  async function crear() {
    const n = nombre.trim()
    if (!n) {
      setError('El nombre del tópico es obligatorio.')
      return
    }
    const p = Number(particiones)
    const r = Number(replicas)
    /* El clúster tiene 3 brokers: pedir más réplicas que brokers hace fallar la
       creación del lado de Kafka, así que se avisa antes de gastar el viaje. */
    if (cluster && r > cluster.cantidadBrokers) {
      setError(`No se pueden pedir ${r} réplicas: el clúster tiene ${cluster.cantidadBrokers} brokers.`)
      return
    }
    setCreando(true)
    setError(null)
    setOk(null)
    try {
      await admin.crearTopico({ nombre: n, particiones: p, replicas: r })
      setOk(`Tópico ${n} creado con ${p} particiones y factor de replicación ${r}.`)
      log(`POST /api/topicos  ${n} (p=${p}, r=${r})`, 'ok')
      setNombre('')
      await cargar()
    } catch (e) {
      setError((e as Error).message)
      log(`error al crear ${n}: ${(e as Error).message}`, 'error')
    } finally {
      setCreando(false)
    }
  }

  async function guardarConfiguracion() {
    if (!detalle) return
    setGuardandoCfg(true)
    setError(null)
    setOk(null)
    const cambios = {
      retentionMs: cfgForm.retentionMs.trim(),
      cleanupPolicy: cfgForm.cleanupPolicy.trim(),
      minInsyncReplicas: cfgForm.minInsyncReplicas.trim(),
    }
    try {
      await admin.editarConfiguracion(detalle.nombre, cambios)
      setOk(`Configuración de ${detalle.nombre} actualizada.`)
      log(`PUT /api/topicos/${detalle.nombre}/configuracion  ${JSON.stringify(cambios)}`, 'ok')
      await verDetalle(detalle.nombre)
    } catch (e) {
      setError((e as Error).message)
      log(`error al editar ${detalle.nombre}: ${(e as Error).message}`, 'error')
    } finally {
      setGuardandoCfg(false)
    }
  }

  /* Kafka sólo permite AUMENTAR particiones: un valor igual o menor se rechaza
     antes de viajar, para no confundir con un error del clúster. */
  async function ampliarParticiones() {
    if (!detalle) return
    const n = Number(nuevasParticiones)
    if (!Number.isInteger(n) || n <= detalle.particiones) {
      setError(`La cantidad debe ser un entero mayor que ${detalle.particiones} (actual).`)
      return
    }
    if (!window.confirm(`¿Subir ${detalle.nombre} de ${detalle.particiones} a ${n} particiones? Kafka no permite bajarlas después.`))
      return
    setError(null)
    setOk(null)
    try {
      await admin.aumentarParticiones(detalle.nombre, n)
      setOk(`${detalle.nombre} ahora tiene ${n} particiones.`)
      log(`PUT /api/topicos/${detalle.nombre}/particiones?cantidad=${n}`, 'ok')
      await verDetalle(detalle.nombre)
      await cargar()
    } catch (e) {
      setError((e as Error).message)
      log(`error al aumentar particiones de ${detalle.nombre}: ${(e as Error).message}`, 'error')
    }
  }

  async function eliminarGrupo(grupo: string) {
    if (!window.confirm(`¿Eliminar el grupo de consumo ${grupo}? Se pierden sus offsets confirmados.`)) return
    setError(null)
    setOk(null)
    try {
      await admin.eliminarGrupo(grupo)
      setOk(`Grupo ${grupo} eliminado.`)
      log(`DELETE /api/consumer-groups/${grupo}`, 'ok')
      if (lag?.groupId === grupo) setLag(null)
      await cargar()
    } catch (e) {
      setError((e as Error).message)
      log(`error al eliminar el grupo ${grupo}: ${(e as Error).message}`, 'error')
    }
  }

  async function resetearOffsets(grupo: string, topico: string) {
    if (!topico) return
    if (!window.confirm(`¿Reiniciar los offsets de ${grupo} en ${topico}? El grupo volverá a leer desde el principio.`))
      return
    setReseteando(true)
    setError(null)
    setOk(null)
    try {
      await admin.resetOffsets(grupo, topico)
      setOk(`Offsets de ${grupo} en ${topico} reiniciados.`)
      log(`PUT /api/consumer-groups/${grupo}/reset-offsets?topico=${topico}`, 'ok')
      await verLag(grupo)
    } catch (e) {
      setError((e as Error).message)
      log(`error al reiniciar offsets de ${grupo}: ${(e as Error).message}`, 'error')
    } finally {
      setReseteando(false)
    }
  }

  async function eliminar(nombreTopico: string) {
    if (!window.confirm(`¿Eliminar el tópico ${nombreTopico}? La operación no se puede deshacer.`)) return
    setError(null)
    setOk(null)
    try {
      await admin.eliminarTopico(nombreTopico)
      setOk(`Tópico ${nombreTopico} eliminado.`)
      log(`DELETE /api/topicos/${nombreTopico}`, 'ok')
      if (detalle?.nombre === nombreTopico) setDetalle(null)
      await cargar()
    } catch (e) {
      setError((e as Error).message)
      log(`error al eliminar ${nombreTopico}: ${(e as Error).message}`, 'error')
    }
  }

  return (
    <div className="stack">
      <PageHeader
        titulo="Administración de Kafka"
        bajada="Clúster de 3 brokers con replicación. Todo lo de esta pantalla pasa por el AdminClient de Kafka expuesto por ms-kafka-admin."
        accion={
          <Button onClick={() => void cargar()} disabled={cargando}>
            {cargando ? <Spinner /> : null}
            Refrescar
          </Button>
        }
      />

      {error && (
        <Notice estado="bad" titulo="Error del microservicio administrador" onCerrar={() => setError(null)}>
          {error} — revisá que ms-kafka-admin esté arriba en <code>:8085</code> y que el clúster responda.
        </Notice>
      )}
      {ok && (
        <Notice estado="ok" titulo="Operación aplicada" onCerrar={() => setOk(null)}>
          {ok}
        </Notice>
      )}

      {/* ---------- clúster ---------- */}
      <div className="metrics">
        <Metric etiqueta="Brokers" valor={cluster?.cantidadBrokers ?? '—'} nota="replicación entre nodos" />
        <Metric etiqueta="Broker controlador" valor={cluster ? `#${cluster.controlador}` : '—'} />
        <Metric etiqueta="Tópicos" valor={topicos?.length ?? '—'} />
        <Metric etiqueta="Grupos de consumo" valor={grupos?.length ?? '—'} />
      </div>

      {cluster && cluster.brokers.length > 0 && (
        <Card titulo="Brokers del clúster" descripcion="GET /api/cluster">
          <Table cols={[{ t: 'ID', num: true }, 'Host', 'Rol']}>
            {cluster.brokers.map((b) => (
              <tr key={b.id}>
                <td className="num">{b.id}</td>
                <td className="mono">{b.host}</td>
                <td>
                  {b.id === cluster.controlador ? <Badge estado="ok">controlador</Badge> : <Badge>réplica</Badge>}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {/* ---------- tópicos ---------- */}
      <Card titulo="Tópicos" descripcion="Clic en un tópico para ver su configuración y el detalle por partición.">
        {!topicos ? (
          <Empty>{cargando ? 'Consultando el clúster…' : 'Sin datos del clúster.'}</Empty>
        ) : topicos.length === 0 ? (
          <Empty>El clúster no tiene tópicos.</Empty>
        ) : (
          <Table
            cols={['Tópico', { t: 'Particiones', num: true }, { t: 'Réplicas', num: true }, 'ISR', '']}
          >
            {topicos.map((t) => (
              <tr key={t.nombre}>
                <td>
                  <button className="link-cell" onClick={() => void verDetalle(t.nombre)}>
                    {t.nombre}
                  </button>
                </td>
                <td className="num">{t.particiones}</td>
                <td className="num">{t.replicas}</td>
                <td className="mono muted">{t.isr ?? '—'}</td>
                <td className="num">
                  {TOPICOS_PROTEGIDOS.has(t.nombre) ? (
                    <Badge>del enunciado</Badge>
                  ) : (
                    <Button variante="peligro" onClick={() => void eliminar(t.nombre)}>
                      Eliminar
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {detalle && (
        <Card
          titulo={`Detalle de ${detalle.nombre}`}
          descripcion="GET /api/topicos/{nombre}"
          accion={
            <Button onClick={() => setDetalle(null)} aria-label="Cerrar detalle">
              Cerrar
            </Button>
          }
        >
          <div className="kv">
            <div>
              <span>retention.ms</span>
              <b className="mono">{detalle.configuracion?.retentionMs ?? '—'}</b>
            </div>
            <div>
              <span>cleanup.policy</span>
              <b className="mono">{detalle.configuracion?.cleanupPolicy ?? '—'}</b>
            </div>
            <div>
              <span>min.insync.replicas</span>
              <b className="mono">{detalle.configuracion?.minInsyncReplicas ?? '—'}</b>
            </div>
            <div>
              <span>segment.bytes</span>
              <b className="mono">{detalle.configuracion?.segmentBytes ?? '—'}</b>
            </div>
          </div>

          <div className="row" style={{ marginTop: 'var(--s4)', alignItems: 'flex-end' }}>
            <Field etiqueta="cleanup.policy" ancho={170}>
              <Input
                value={cfgForm.cleanupPolicy}
                onChange={(e) => setCfgForm({ ...cfgForm, cleanupPolicy: e.target.value })}
                placeholder="delete"
              />
            </Field>
            <Field etiqueta="retention.ms" ancho={170}>
              <Input
                value={cfgForm.retentionMs}
                onChange={(e) => setCfgForm({ ...cfgForm, retentionMs: e.target.value })}
              />
            </Field>
            <Field etiqueta="min.insync.replicas" ancho={170}>
              <Input
                value={cfgForm.minInsyncReplicas}
                onChange={(e) => setCfgForm({ ...cfgForm, minInsyncReplicas: e.target.value })}
              />
            </Field>
            <Button variante="primario" onClick={() => void guardarConfiguracion()} disabled={guardandoCfg}>
              {guardandoCfg ? <Spinner /> : null}
              Guardar configuración
            </Button>
          </div>

          <div className="row" style={{ marginTop: 'var(--s4)', alignItems: 'flex-end' }}>
            <Field etiqueta="Particiones nuevas" ancho={170} hint={`actualmente ${detalle.particiones}`}>
              <Input
                type="number"
                min={detalle.particiones + 1}
                value={nuevasParticiones}
                onChange={(e) => setNuevasParticiones(e.target.value)}
              />
            </Field>
            <Button onClick={() => void ampliarParticiones()}>Aumentar particiones</Button>
          </div>

          <div style={{ marginTop: 'var(--s4)', marginLeft: 'calc(var(--s4) * -1)', marginRight: 'calc(var(--s4) * -1)', marginBottom: 'calc(var(--s4) * -1)' }}>
            <Table
              cols={[{ t: 'Partición', num: true }, { t: 'Líder', num: true }, 'Réplicas', 'ISR', 'Estado']}
            >
              {(detalle.particionesDetalle ?? []).map((p) => {
                const sincronizada = p.isr.length === p.replicas.length
                return (
                  <tr key={p.numero}>
                    <td className="num">{p.numero}</td>
                    <td className="num">broker {p.lider}</td>
                    <td className="mono">{p.replicas.join(', ')}</td>
                    <td className="mono">{p.isr.join(', ')}</td>
                    <td>
                      {sincronizada ? (
                        <Badge estado="ok">en sincronía</Badge>
                      ) : (
                        <Badge estado="warn">
                          {p.isr.length}/{p.replicas.length} réplicas
                        </Badge>
                      )}
                    </td>
                  </tr>
                )
              })}
            </Table>
          </div>
        </Card>
      )}

      {/* ---------- crear tópico ---------- */}
      <Card
        titulo="Crear un tópico"
        descripcion="POST /api/topicos. El factor de replicación no puede superar la cantidad de brokers."
      >
        <div className="row">
          <Field etiqueta="Nombre" ancho={240}>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="pedidos-demo" />
          </Field>
          <Field etiqueta="Particiones" ancho={120}>
            <Input type="number" min={1} value={particiones} onChange={(e) => setParticiones(e.target.value)} />
          </Field>
          <Field
            etiqueta="Réplicas"
            ancho={120}
            hint={cluster ? `máximo ${cluster.cantidadBrokers}` : undefined}
          >
            <Input type="number" min={1} value={replicas} onChange={(e) => setReplicas(e.target.value)} />
          </Field>
          <Button variante="primario" onClick={crear} disabled={creando}>
            {creando ? <Spinner /> : null}
            Crear tópico
          </Button>
        </div>
      </Card>

      {/* ---------- grupos de consumo ---------- */}
      <Card titulo="Grupos de consumo" descripcion="Clic en un grupo para ver su desfase por partición.">
        {!grupos ? (
          <Empty>{cargando ? 'Consultando los grupos…' : 'Sin datos de grupos.'}</Empty>
        ) : grupos.length === 0 ? (
          <Empty>No hay grupos de consumo registrados en el clúster.</Empty>
        ) : (
          <Table cols={['Grupo', 'Estado', { t: 'Miembros', num: true }, 'Tópicos', '']}>
            {grupos.map((g: ConsumerGroup) => (
              <tr key={g.id}>
                <td className="mono">{g.id}</td>
                <td>
                  <Badge estado={estadoDeGrupo(g.estado)}>{g.estado.toLowerCase()}</Badge>
                </td>
                <td className="num">{g.cantidadMiembros}</td>
                <td className="mono muted">{g.topicos?.join(', ') || '—'}</td>
                <td className="num">
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--s2)' }}>
                    <Button onClick={() => void verLag(g.id)}>Ver desfase</Button>
                    <Button variante="peligro" disabled={g.cantidadMiembros > 0} onClick={() => void eliminarGrupo(g.id)}>
                      Eliminar
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {lag && (
        <Card
          titulo={`Desfase de ${lag.groupId}`}
          descripcion="offsetFinal − offsetActual por partición. Un lag que no baja indica un consumidor detenido."
          accion={
            <div className="row" style={{ alignItems: 'center' }}>
              <Badge estado={lag.lagTotal === 0 ? 'ok' : lag.lagTotal > 100 ? 'bad' : 'warn'}>
                lag total {num(lag.lagTotal)}
              </Badge>
              {(() => {
                const grupo = grupos?.find((g) => g.id === lag.groupId)
                const activo = grupo ? grupo.cantidadMiembros > 0 || grupo.estado.toUpperCase() === 'STABLE' : true
                const topicosGrupo = grupo?.topicos ?? []
                const topicoElegido = topicoReset || topicosGrupo[0] || ''
                return (
                  <>
                    <select
                      className="input"
                      value={topicoElegido}
                      onChange={(e) => setTopicoReset(e.target.value)}
                      disabled={activo || topicosGrupo.length === 0}
                      aria-label="Tópico para reiniciar offsets"
                    >
                      {topicosGrupo.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <Button
                      variante="peligro"
                      disabled={activo || reseteando || !topicoElegido}
                      title={activo ? 'Sólo se reinicia un grupo sin miembros activos' : undefined}
                      onClick={() => void resetearOffsets(lag.groupId, topicoElegido)}
                    >
                      {reseteando ? <Spinner /> : null}
                      Reiniciar offsets
                    </Button>
                  </>
                )
              })()}
              <Button onClick={() => setLag(null)}>Cerrar</Button>
            </div>
          }
        >
          {(lag.detalles ?? []).length === 0 ? (
            <Empty>El grupo no tiene offsets asignados todavía.</Empty>
          ) : (
            <Table
              cols={[
                'Tópico',
                { t: 'Partición', num: true },
                { t: 'Offset actual', num: true },
                { t: 'Offset final', num: true },
                { t: 'Lag', num: true },
              ]}
            >
              {lag.detalles.map((d) => (
                <tr key={`${d.topico}-${d.particion}`}>
                  <td className="mono">{d.topico}</td>
                  <td className="num">{d.particion}</td>
                  {/* Sin separador de miles: un offset es una posición en el
                      log, no una cantidad, y "1.200" se lee como decimal. */}
                  <td className="num">{d.offsetActual}</td>
                  <td className="num">{d.offsetFinal}</td>
                  <td className="num" style={{ color: d.lag > 0 ? 'var(--warn)' : 'var(--ok)' }}>
                    {d.lag}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      <LogPanel lineas={lineas} onLimpiar={limpiar} />
    </div>
  )
}
