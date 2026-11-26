import { Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { CallbackScreen } from './screens/CallbackScreen'
import { KafkaScreen } from './screens/KafkaScreen'
import { OperacionesScreen } from './screens/OperacionesScreen'
import { PagosScreen } from './screens/PagosScreen'
import { RabbitScreen } from './screens/RabbitScreen'
import { RecomendacionesScreen } from './screens/RecomendacionesScreen'

export function App() {
  return (
    <Routes>
      {/* /callback queda FUERA del Shell: es la vuelta de Transbank y se muestra
          como pantalla de resultado, sin la navegación lateral alrededor. */}
      <Route path="/callback" element={<CallbackScreen />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/pagos" replace />} />
        <Route path="/pagos" element={<PagosScreen />} />
        <Route path="/recomendaciones" element={<RecomendacionesScreen />} />
        <Route path="/operaciones" element={<OperacionesScreen />} />
        <Route path="/kafka" element={<KafkaScreen />} />
        <Route path="/rabbit" element={<RabbitScreen />} />
        <Route path="*" element={<Navigate to="/pagos" replace />} />
      </Route>
    </Routes>
  )
}
