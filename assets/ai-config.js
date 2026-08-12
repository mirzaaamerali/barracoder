/* Where the AI helper lives. Set this to the deployed Cloudflare Worker URL —
   e.g. 'https://barracoder-ai.<subdomain>.workers.dev'.

   While it is an empty string the assistant UI stays hidden on every page, so
   nobody clicks a button that can't work. Nothing secret belongs in this file:
   the API key lives in a Worker secret, and the team passcode is typed by the
   person using it. */
window.BARRACODER_AI_ENDPOINT = '';
