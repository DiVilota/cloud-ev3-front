/* Tipos espejo de los DTO de Spring. Los nombres de campo son los que viajan en
   el JSON, no se renombran: cualquier desvío acá es un bug silencioso en runtime. */

/* ---- Actuator (los tres servicios) ---- */
/* El detalle por componente depende de lo que cada servicio tenga configurado:
   ms-pago y ms-recomendaciones reportan "db", y ms-kafka-admin agrega
   "kafkaCluster" con su indicador propio. Por eso components es abierto. */
export type ComponenteActuator = {
  status: string
  details?: Record<string, unknown>
}

export type EstadoActuator = {
  status: 'UP' | 'DOWN' | 'OUT_OF_SERVICE' | 'UNKNOWN' | string
  components?: Record<string, ComponenteActuator>
}

/* ---- ms-pago :8083 ---- */
export type PeticionPago = {
  clientId: string
  amount: number
  transactionId: string
  /* Solo en el modo simulado: número de tarjeta de prueba. */
  tarjeta?: string
}

/* PagosController responde un Map, no el DTO: {url, token} o {message} o {error} */
export type RespuestaIniciarPago = {
  url?: string
  token?: string
  message?: string
  error?: string
}

export type AlertaFraude = {
  idCliente: string
  /* El antifraude cuenta por tarjeta: huellaTarjeta identifica la tarjeta sin
     exponer el número, y ultimos4 es lo único que se muestra al operador. */
  huellaTarjeta?: string
  ultimos4?: string | null
  cantidadIntentos: number
  bloqueadoHasta: string
  minutosRestantes: number
  actualizadoEn: string
}

export type ResumenAlertas = {
  bloqueosActivos: number
  totalClientesVigilados: number
  alertas: AlertaFraude[]
}

/* ---- ms-recomendaciones :8084 ---- */
export type Interaccion = {
  clientId: string
  itemId: string
  action: 'view' | 'cart' | 'purchase'
  category: string
  productType: string
}

export type ProductoEnriquecido = {
  rankPosition: number
  score: number
  itemId: string
  nombre: string
  categoria: string
  marca: string
  precio: number
  calificacion: number
  imagenUrl: string
  /* Razón de la recomendación, si el servicio la informa. */
  motivo?: string
}

/* Producto del catálogo de ms-productos :8086. */
export type ProductoCatalogo = {
  id: string
  nombre: string
  marca: string
  categoria: string
  categoriaEtiqueta: string
  subcategoria: string
  precio: number
  stock: number
  calificacion: number
  imagenUrl: string | null
  descripcion: string
}

export type ProductoVisto = {
  itemId: string
  nombre: string
  categoria: string
  vistas: number
}

export type SerieMinuto = {
  inicio: number
  interacciones: number
}

export type Embudo = {
  vistas: number
  carritos: number
  compras: number
}

export type Metricas = {
  tipo?: string
  timestamp?: number
  interaccionesPorMinuto: number
  serieMinutos: SerieMinuto[]
  topProductos: ProductoVisto[]
  usuariosActivos: number
  embudo: Embudo
  porTipo: Record<string, number>
  totalInteracciones: number
  productosMasVistos: ProductoVisto[]
}

/* ---- ms-kafka-admin :8085 ---- */
export type Topico = {
  nombre: string
  particiones: number
  replicas: number
  isr: string
}

export type ConfiguracionTopico = {
  retentionMs: string
  cleanupPolicy: string
  minInsyncReplicas: string
  segmentBytes: string
}

export type ParticionDetalle = {
  numero: number
  lider: number
  replicas: number[]
  isr: number[]
}

export type TopicoDetalle = Topico & {
  configuracion: ConfiguracionTopico
  particionesDetalle: ParticionDetalle[]
}

export type CrearTopicoRequest = {
  nombre: string
  particiones: number
  replicas: number
  retentionMs?: number | null
  cleanupPolicy?: string | null
  minInsyncReplicas?: number | null
}

export type Broker = {
  id: number
  host: string
}

export type Cluster = {
  cantidadBrokers: number
  brokers: Broker[]
  controlador: number
}

export type ConsumerGroup = {
  id: string
  estado: string
  cantidadMiembros: number
  topicos: string[]
}

export type LagDetalle = {
  topico: string
  particion: number
  offsetActual: number
  offsetFinal: number
  lag: number
}

export type ConsumerGroupLag = {
  groupId: string
  lagTotal: number
  detalles: LagDetalle[]
}

/* ---- ms-rabbit-admin :8089 ---- */
export type RabbitNodo = {
  nombre: string
  tipo: string
  corriendo: boolean
  memoriaUsadaBytes: number
  memoriaLimiteBytes: number
  porcentajeMemoria: number
  alarmaMemoria: boolean
  discoLibreBytes: number
  discoLimiteBytes: number
  alarmaDisco: boolean
  particiones: string[]
  uptimeMs: number
}

export type RabbitCluster = {
  nombreCluster: string
  totalNodos: number
  nodosCorriendo: number
  hayQuorum: boolean
  hayParticiones: boolean
  hayAlarmas: boolean
  nodos: RabbitNodo[]
  fuente: string
  consultadoEn: number
}

export type RabbitCola = {
  nombre: string
  vhost: string
  tipo: string
  durable: boolean
  autoEliminar: boolean
  exclusiva: boolean
  mensajes: number
  mensajesListos: number
  mensajesSinConfirmar: number
  consumidores: number
  estado: string
  nodo: string
  miembros: string[]
  miembrosEnLinea: string[]
  argumentos: Record<string, unknown>
  protegida: boolean
}

export type RabbitExchange = {
  nombre: string
  vhost: string
  tipo: string
  durable: boolean
  autoEliminar: boolean
  interno: boolean
  argumentos: Record<string, unknown>
  protegido: boolean
}

export type RabbitBinding = {
  origen: string
  destino: string
  tipoDestino: string
  routingKey: string
  argumentos: Record<string, unknown>
  propertiesKey: string
  protegido: boolean
}

/* ---- ms-notificaciones :8088 ---- */
export type NotificacionFallida = {
  id: number
  messageId: string
  colaOrigen: string
  exchangeOrigen: string
  routingKeys: string
  motivo: string
  conteo: number
  cuerpo: string
  recibidoEn: string
}
