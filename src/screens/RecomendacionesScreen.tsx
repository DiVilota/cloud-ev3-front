import { useCallback, useEffect, useMemo, useState } from 'react'
import { LogPanel } from '../components/LogPanel'
import { PageHeader } from '../components/Shell'
import { Badge, Bar, Button, Card, Empty, Field, Input, Notice, Spinner, Table } from '../components/ui'
import { useLog } from '../hooks/useLog'
import { productos, recomendaciones } from '../lib/api'
import { clp } from '../lib/format'
import type { ProductoCatalogo, ProductoEnriquecido } from '../lib/types'

/* Pesos de cada acción. El consumidor en ms-recomendaciones es quien los aplica;
   acá solo se muestran para que la pantalla explique qué suma cada acción. */
const ACCIONES = [
  { id: 'view', etiqueta: 'Ver', peso: 1 },
  { id: 'cart', etiqueta: 'Carrito', peso: 2 },
  { id: 'purchase', etiqueta: 'Comprar', peso: 3 },
] as const

/* Si el producto no está en el catálogo (se tipeó a mano), la interacción va con
   estos valores, igual que antes de leer el catálogo desde ms-productos. */
const CLASIFICACION_DESCONOCIDA = { categoria: 'general', subcategoria: 'standard' }

/* El consumidor recalcula el ranking de forma asíncrona: si se consulta el Top
   inmediatamente después de publicar, todavía devuelve el valor viejo. 1,2 s es
   el margen que usa la demo para que el recálculo ya esté persistido. */
const ESPERA_RECALCULO_MS = 1200

export function RecomendacionesScreen() {
  const [usuario, setUsuario] = useState('user_test_1')
  const [item, setItem] = useState('item_116')
  const [catalogo, setCatalogo] = useState<ProductoCatalogo[]>([])
  const [top, setTop] = useState<ProductoEnriquecido[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState<string | null>(null)
  const { lineas, log, limpiar } = useLog()

  const productoPorId = useMemo(() => new Map(catalogo.map((p) => [p.id, p])), [catalogo])
  const productoActual = productoPorId.get(item.trim())

  const cargarCatalogo = useCallback(async () => {
    try {
      const datos = await productos.listar()
      setCatalogo(datos)
      log(`GET /api/productos → ${datos.length} producto(s) en el catálogo`, 'ok')
    } catch (e) {
      log(`catálogo: ${(e as Error).message}`, 'error')
    }
  }, [log])

  const cargarTop = useCallback(
    async (silencioso = false) => {
      const usr = usuario.trim()
      if (!usr) return
      if (!silencioso) setCargando(true)
      try {
        const datos = await recomendaciones.top(usr)
        setTop(datos)
        setError(null)
        log(`GET /api/recomendaciones?userId=${usr} → ${datos.length} resultado(s)`, 'ok')
      } catch (e) {
        setError((e as Error).message)
        log(`error al leer el Top: ${(e as Error).message}`, 'error')
      } finally {
        setCargando(false)
      }
    },
    [usuario, log],
  )

  useEffect(() => {
    void cargarCatalogo()
    void cargarTop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function interactuar(accion: string, peso: number) {
    const usr = usuario.trim()
    const prod = item.trim()
    if (!usr || !prod) {
      setError('Usuario y producto son obligatorios.')
      return
    }
    const { categoria, subcategoria } = productoPorId.get(prod) ?? CLASIFICACION_DESCONOCIDA
    setEnviando(accion)
    try {
      await recomendaciones.interactuar({
        clientId: usr,
        itemId: prod,
        action: accion as 'view' | 'cart' | 'purchase',
        category: categoria,
        productType: subcategoria,
      })
      log(`POST /api/interacciones  ${accion}(+${peso}) ${prod} [${categoria}/${subcategoria}]`, 'ok')
      setError(null)
      setTimeout(() => void cargarTop(true), ESPERA_RECALCULO_MS)
    } catch (e) {
      setError((e as Error).message)
      log(`error al publicar la interacción: ${(e as Error).message}`, 'error')
    } finally {
      setEnviando(null)
    }
  }

  const maxScore = top && top.length > 0 ? Math.max(...top.map((p) => p.score)) : 0

  return (
    <div className="stack">
      <PageHeader
        titulo="Recomendaciones"
        bajada="Clickstream sobre el tópico interacciones-user. El consumidor acumula puntaje por producto y persiste el ranking; la tabla es el Top del usuario consultado."
        accion={
          <Button onClick={() => void cargarTop()} disabled={cargando}>
            {cargando ? <Spinner /> : null}
            Refrescar Top
          </Button>
        }
      />

      <Card
        titulo="Generar interacción"
        descripcion="Cada acción publica un evento en Kafka con su peso. El ranking se recalcula en el consumidor, no acá."
      >
        <div className="row">
          <Field etiqueta="clientId" ancho={190}>
            <Input value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="user_test_1" />
          </Field>
          <Field
            etiqueta="itemId"
            ancho={190}
            hint={
              productoActual
                ? `${productoActual.categoria} / ${productoActual.subcategoria}`
                : catalogo.length === 0
                  ? 'catálogo sin cargar'
                  : 'no está en el catálogo'
            }
          >
            <Input value={item} onChange={(e) => setItem(e.target.value)} list="items-catalogo" />
            <datalist id="items-catalogo">
              {catalogo.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </datalist>
          </Field>
          {ACCIONES.map((a) => (
            <Button
              key={a.id}
              variante={a.id === 'purchase' ? 'primario' : 'ghost'}
              onClick={() => void interactuar(a.id, a.peso)}
              disabled={enviando !== null}
            >
              {enviando === a.id ? <Spinner /> : null}
              {a.etiqueta} +{a.peso}
            </Button>
          ))}
        </div>

        {error && (
          <div style={{ marginTop: 'var(--s4)' }}>
            <Notice estado="bad" titulo="No se pudo completar la operación" onCerrar={() => setError(null)}>
              {error} — revisá que ms-recomendaciones esté arriba en <code>:8084</code>.
            </Notice>
          </div>
        )}
      </Card>

      <Card
        titulo={`Top del usuario`}
        descripcion={`Resultado de GET /api/recomendaciones para ${usuario.trim() || '—'}`}
        accion={top ? <Badge>{top.length} productos</Badge> : null}
      >
        {!top || top.length === 0 ? (
          <Empty>
            Sin recomendaciones para este usuario todavía. Generá interacciones y esperá el recálculo del consumidor.
          </Empty>
        ) : (
          <Table
            cols={[
              { t: '#', num: true },
              'Producto',
              'Marca',
              'Categoría',
              { t: 'Precio', num: true },
              { t: 'Calificación', num: true },
              { t: 'Puntaje', num: true },
              'Peso relativo',
            ]}
          >
            {top.map((p) => (
              <tr key={p.itemId}>
                <td className="num" style={{ color: 'var(--accent-bright)' }}>
                  {p.rankPosition}
                </td>
                <td>
                  <div className="producto">
                    {p.imagenUrl ? (
                      <img
                        className="producto__img"
                        src={p.imagenUrl}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.visibility = 'hidden'
                        }}
                      />
                    ) : (
                      <span className="producto__img producto__img--vacia" aria-hidden="true">
                        {(p.nombre || p.itemId).charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span>
                      <strong>{p.nombre || p.itemId}</strong>
                      <small className="mono muted">{p.itemId}</small>
                      {p.motivo && <small className="muted">{p.motivo}</small>}
                    </span>
                  </div>
                </td>
                <td>{p.marca || '—'}</td>
                <td>{p.categoria || '—'}</td>
                <td className="num">{clp(p.precio)}</td>
                <td className="num">{p.calificacion ? p.calificacion.toFixed(1) : '—'}</td>
                <td className="num">{p.score?.toFixed(1) ?? '—'}</td>
                <td>
                  <Bar valor={p.score} max={maxScore} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <LogPanel lineas={lineas} onLimpiar={limpiar} />
    </div>
  )
}
