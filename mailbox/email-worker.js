/**
 * Cloudflare Email Worker — makes verification codes machine-readable.
 *
 * Route a catch-all address on a spare domain to this worker (Cloudflare
 * dashboard → Email → Email Routing → Routes → catch-all → Send to a Worker).
 * Every incoming message is written to R2 as JSON, where the farm can read it
 * with the R2 credentials already on the VPS. One fresh address per TikTok
 * account, never reused.
 *
 * wrangler.toml needs:
 *   [[r2_buckets]]
 *   binding = "MAIL"
 *   bucket_name = "<your bucket>"
 */
export default {
    async email(message, env) {
        const to = (message.to || 'unknown').toLowerCase();
        const raw = await new Response(message.raw).text();

        // TikTok's code is a standalone 4–8 digit run. Take the first that is not
        // part of a longer number (years, ids, phone numbers).
        const code = (raw.match(/(?<![0-9])[0-9]{4,8}(?![0-9])/g) || [])
            .find((candidate) => candidate.length >= 4 && candidate.length <= 8) || null;

        const record = {
            to,
            from: message.from,
            subject: message.headers.get('subject') || '',
            receivedAt: new Date().toISOString(),
            code,
            // Keep a trimmed body for debugging a miss, not the whole message.
            excerpt: raw.replace(/\s+/g, ' ').slice(0, 600),
        };

        const key = `mail/${to}/${Date.now()}.json`;
        await env.MAIL.put(key, JSON.stringify(record), {
            httpMetadata: { contentType: 'application/json' },
        });
    },
};
