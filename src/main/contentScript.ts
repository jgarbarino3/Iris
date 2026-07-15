'use strict';

import { registerEditorBridge } from './editorBridge/bridge';
import { registerInlineDiffOverlay } from './inlineDiffOverlay';
import { registerCitationIndicator } from './citationIndicator';
import { registerCitationKeyPopup } from './citationKeyPopup';
import { registerOverleafFolderPublisher } from './overleafFolder';
import { registerOverleafCompile } from './overleafCompile';

registerEditorBridge();
registerInlineDiffOverlay();
registerCitationIndicator();
registerCitationKeyPopup();
registerOverleafFolderPublisher();
registerOverleafCompile();
