import Dashboard from './Dashboard.jsx';
import ActionsLab from './ActionsLab.jsx';
import { createStandardIntegrationViews } from '../../../../integrations/_shared/ui/standardViews.jsx';

const standardViews = createStandardIntegrationViews();

export const views = {
  dashboard: Dashboard,
  history: standardViews.history,
  'actions-lab': ActionsLab,
  settings: standardViews.settings
};
