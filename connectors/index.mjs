import {notion} from './notion.mjs';
import {gdrive} from './gdrive.mjs';
// A connector is {id,label,auth:'token'|'oauth',verify|connect,changes}. changes() yields {document}, {removed:[externalIds]},
// and finally {cursor,credentials?}; the Library stores the cursor so the next sync only reads what changed.
export const CONNECTORS=Object.freeze({notion,gdrive});
