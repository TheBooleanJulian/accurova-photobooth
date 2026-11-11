import { Navigate, Route, Routes } from 'react-router-dom';
import { CameraDiagnosticsPage } from '../pages/CameraDiagnosticsPage';
import { ComposePreviewPage } from '../pages/ComposePreviewPage';
import { DiagnosticsReportPage } from '../pages/DiagnosticsReportPage';
import { DownloadPage } from '../pages/DownloadPage';
import { HomePage } from '../pages/HomePage';
import { KioskWelcomePage } from '../pages/KioskWelcomePage';

/**
 * Routes. Admin routes are NOT yet authenticated (M7); until then the
 * diagnostics page only touches the local camera and stores nothing remotely.
 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/kiosk/:templateId" element={<KioskWelcomePage />} />
      <Route path="/d/:token" element={<DownloadPage />} />
      <Route path="/admin" element={<Navigate to="/admin/diagnostics" replace />} />
      <Route path="/admin/diagnostics" element={<CameraDiagnosticsPage />} />
      <Route path="/admin/compose" element={<ComposePreviewPage />} />
      <Route path="/admin/report" element={<DiagnosticsReportPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
