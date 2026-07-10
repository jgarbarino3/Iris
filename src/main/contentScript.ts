'use strict';

import { registerEditorBridge } from './editorBridge/bridge';
import { registerInlineDiffOverlay } from './inlineDiffOverlay';
import { registerCitationIndicator } from './citationIndicator';
import { registerCitationKeyPopup } from './citationKeyPopup';

registerEditorBridge();
registerInlineDiffOverlay();
registerCitationIndicator();
registerCitationKeyPopup();
