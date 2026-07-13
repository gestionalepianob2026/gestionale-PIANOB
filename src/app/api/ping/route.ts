// Endpoint leggerissimo per il keep-alive (evita lo "sleep" del piano free
// di Render). Un cron esterno lo chiama ogni ~10 minuti. Non tocca il DB.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, ts: Date.now() });
}
