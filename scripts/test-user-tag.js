// 🧪 Tag a test script's own fresh anonymous user (migration 0223) so the owner page (stats.html → owner_stats2) does not
// count it. Call right after signInAnonymously(). Works on an old server too (metadata only).
//   const { tagTestUser } = require("./test-user-tag.js");
//   await sb.auth.signInAnonymously(); await tagTestUser(sb);
async function tagTestUser(sb) {
  const out = { meta: false, rpc: false };
  try { const r = await sb.auth.updateUser({ data: { test: true } }); out.meta = !r.error; } catch (e) {}
  try { const r = await sb.rpc("mark_me_test"); out.rpc = !r.error; } catch (e) {}
  return out;
}
module.exports = { tagTestUser };
