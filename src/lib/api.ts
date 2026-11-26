import { API } from '../config'
import type {
  Cluster,
  EstadoActuator,
  ConsumerGroup,
  ConsumerGroupLag,
  CrearTopicoRequest,
  Interaccion,
  ConfiguracionTopico,
  Metricas,
  NotificacionFallida,
  PeticionPago,
  ProductoCatalogo,
  ProductoEnriquecido,
  RabbitBinding,
  RabbitCluster,
  RabbitCola,
  RabbitExchange,
  RespuestaIniciarPago,
  ResumenAlertas,
  Topico,
  TopicoDetalle,
} from './types'

/* Un fallo de red y un 500 del servicio son problemas distintos y se muestran
   distinto en la UI, así que se distinguen con una clase de error propia. */
export class ApiError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(status: number, mensaje: string, body?: unknown) {
    super(mensaje)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
  /** status 0 = nunca salió del navegador (servicio caído, CORS, DNS). */
  get esDeRed() {
    return this.status === 0
  }
}

const TIMEOUT_MS = 8000

/* Cada servicio nombra distinto el campo de error: ms-pago usa "message" o
   "error", ms-kafka-admin usa "mensaje", y algunos endpoints devuelven texto
   plano. Un solo lugar decide qué leer. */
function mensajeDe(cuerpo: unknown, status: number): string {
  if (typeof cuerpo === 'string' && cuerpo.trim()) return cuerpo.trim()
  if (cuerpo && typeof cuerpo === 'object') {
    const obj = cuerpo as Record<string, unknown>
    for (const clave of ['message', 'mensaje', 'error']) {
      const valor = obj[clave]
      if (typeof valor === 'string' && valor.trim()) return valor.trim()
    }
  }
  return `HTTP ${status}`
}

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (e) {
    const msg = e instanceof Error && e.name === 'TimeoutError' ? 'tiempo de espera agotado' : 'no se pudo contactar el servicio'
    throw new ApiError(0, msg)
  }

  const texto = await res.text()
  let cuerpo: unknown = null
  if (texto) {
    try {
      cuerpo = JSON.parse(texto)
    } catch {
      cuerpo = texto
    }
  }

  if (!res.ok) throw new ApiError(res.status, mensajeDe(cuerpo, res.status), cuerpo)

  return cuerpo as T
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

/* ===================== salud (los tres) ===================== */
/* Sirve para cualquiera de las tres bases porque el endpoint es el mismo.
   Un health DOWN responde 503, y ese caso lo resuelve quien llama leyendo
   ApiError.body: el cuerpo del 503 trae el detalle por componente. */
export const salud = (base: string) => pedir<EstadoActuator>(`${base}/actuator/health`)

/* ======================= ms-pago :8083 ======================= */
export const pagos = {
  /* El 429 del antifraude NO es una excepción: es un resultado esperado de la
     demostración, así que se devuelve como dato en lugar de lanzarse. */
  async iniciar(peticion: PeticionPago): Promise<{ status: number; body: RespuestaIniciarPago }> {
    let res: Response
    try {
      res = await fetch(`${API.pagos}/api/pagos/iniciar`, {
        ...json(peticion),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new ApiError(0, 'el servicio de pagos no responde')
    }
    let body: RespuestaIniciarPago = {}
    try {
      body = (await res.json()) as RespuestaIniciarPago
    } catch {
      /* 400 de validación de Spring puede venir sin cuerpo JSON */
    }
    return { status: res.status, body }
  },

  alertas: () => pedir<ResumenAlertas>(`${API.pagos}/api/alertas`),
  resetAlertas: () => pedir<string>(`${API.pagos}/api/alertas`, { method: 'DELETE' }),
}

/* ================== ms-recomendaciones :8084 ================== */
export const recomendaciones = {
  interactuar: (i: Interaccion) => pedir<string>(`${API.recomendaciones}/api/interacciones`, json(i)),

  top: (userId: string) =>
    pedir<ProductoEnriquecido[]>(
      `${API.recomendaciones}/api/recomendaciones?userId=${encodeURIComponent(userId)}`,
    ),

  metricas: () => pedir<Metricas>(`${API.recomendaciones}/api/metricas`),
}

/* =================== ms-kafka-admin :8085 =================== */
export const admin = {
  cluster: () => pedir<Cluster>(`${API.admin}/api/cluster`),
  topicos: () => pedir<Topico[]>(`${API.admin}/api/topicos`),
  topico: (nombre: string) => pedir<TopicoDetalle>(`${API.admin}/api/topicos/${encodeURIComponent(nombre)}`),
  crearTopico: (req: CrearTopicoRequest) => pedir<string>(`${API.admin}/api/topicos`, json(req)),
  eliminarTopico: (nombre: string) =>
    pedir<string>(`${API.admin}/api/topicos/${encodeURIComponent(nombre)}`, { method: 'DELETE' }),
  consumerGroups: () => pedir<ConsumerGroup[]>(`${API.admin}/api/consumer-groups`),
  lag: (id: string) => pedir<ConsumerGroupLag>(`${API.admin}/api/consumer-groups/${encodeURIComponent(id)}/lag`),
  editarConfiguracion: (nombre: string, config: Partial<ConfiguracionTopico>) =>
    pedir<string>(`${API.admin}/api/topicos/${encodeURIComponent(nombre)}/configuracion`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    }),
  aumentarParticiones: (nombre: string, cantidad: number) =>
    pedir<string>(`${API.admin}/api/topicos/${encodeURIComponent(nombre)}/particiones?cantidad=${cantidad}`, {
      method: 'PUT',
    }),
  resetOffsets: (id: string, topico: string) =>
    pedir<string>(
      `${API.admin}/api/consumer-groups/${encodeURIComponent(id)}/reset-offsets?topico=${encodeURIComponent(topico)}`,
      { method: 'PUT' },
    ),
  eliminarGrupo: (id: string) =>
    pedir<string>(`${API.admin}/api/consumer-groups/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

/* ===================== ms-productos :8086 ===================== */
export const productos = {
  listar: () => pedir<ProductoCatalogo[]>(`${API.productos}/api/productos`),
}

/* ===================== ms-rabbit-admin :8089 ===================== */
export const rabbit = {
  cluster: () => pedir<RabbitCluster>(`${API.rabbit}/api/rabbit/cluster`),
  colas: () => pedir<RabbitCola[]>(`${API.rabbit}/api/rabbit/colas`),
  exchanges: () => pedir<RabbitExchange[]>(`${API.rabbit}/api/rabbit/exchanges`),
  bindings: () => pedir<RabbitBinding[]>(`${API.rabbit}/api/rabbit/bindings`),
  crearCola: (req: { nombre: string; tipo?: string; durable?: boolean }) =>
    pedir<string>(`${API.rabbit}/api/rabbit/colas`, json(req)),
  eliminarCola: (nombre: string) =>
    pedir<string>(`${API.rabbit}/api/rabbit/colas/${encodeURIComponent(nombre)}`, { method: 'DELETE' }),
}

/* ===================== ms-notificaciones :8088 ===================== */
export const notificaciones = {
  fallidas: () => pedir<NotificacionFallida[]>(`${API.notificaciones}/api/notificaciones/fallidas`),
}
