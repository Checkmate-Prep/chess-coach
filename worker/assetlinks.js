// /.well-known/assetlinks.json: tells Android that the Play Store app com.checkmateprep.app may open
// checkmateprep.com full screen (a Trusted Web Activity), without a URL bar. Chrome fetches it from
// each address the app opens, so every environment serves it.
// The fingerprints are certificate hashes, not secrets. Two are needed: Play re-signs the app with its
// own key (the first), and a build installed straight from Bubblewrap is signed with the upload key.
import { json } from './http.js';

export const PACKAGE = 'com.checkmateprep.app';
export const FINGERPRINTS = [
  'CE:A5:38:C0:8C:3D:7F:86:18:69:6C:EE:98:0C:47:A8:79:41:2E:CE:94:D8:AD:30:FF:60:8D:00:0B:C8:D1:F2', // Play app signing key
  '25:00:FE:91:FE:E5:5B:4E:E8:B4:CC:F9:CC:E4:9C:27:09:AA:81:5E:17:FF:4E:F1:F5:F6:6D:50:29:38:28:D3', // upload key
];

export function assetLinks(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Not found.' }, 404);
  return json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: PACKAGE, sha256_cert_fingerprints: FINGERPRINTS },
  }]);
}
