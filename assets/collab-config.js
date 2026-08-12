/* Team journal — Google Form wiring.
 *
 * Paste two URLs here and a "Journal" tab appears on the team site. Until
 * formEmbedUrl is set, the tab doesn't exist at all.
 *
 * formEmbedUrl      Google Form -> Send -> < >  (embed).  Copy the src="..."
 *                   out of the <iframe> snippet. It ends in /viewform?embedded=true
 *
 * responsesEmbedUrl OPTIONAL. In the linked Google Sheet:
 *                   File -> Share -> Publish to web -> pick the responses sheet
 *                   -> Embed -> copy the src="..." (ends in /pubhtml?widget=true&headers=false)
 *                   Leave empty and the form still works; you just won't see
 *                   past entries on the site.
 *
 * Nothing secret goes in this file. Setup steps: docs/collaboration.md
 */
window.BARRACODER_COLLAB = {
  formEmbedUrl: '',
  responsesEmbedUrl: ''
};
