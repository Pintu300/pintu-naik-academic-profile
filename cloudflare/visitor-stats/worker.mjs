const API_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ANALYTICS_URL = "https://analyticsdata.googleapis.com/v1beta";

const encodeBase64Url = (value) => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};

const decodePrivateKey = (pem) => {
  const base64 = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
};

const createSignedAssertion = async (clientEmail, privateKey) => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsignedToken = [
    encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    encodeBase64Url(
      JSON.stringify({
        iss: clientEmail,
        scope: API_SCOPE,
        aud: TOKEN_URL,
        iat: issuedAt,
        exp: issuedAt + 3600
      })
    )
  ].join(".");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    decodePrivateKey(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken)
  );

  return `${unsignedToken}.${encodeBase64Url(signature)}`;
};

const getAccessToken = async (env) => {
  const assertion = await createSignedAssertion(env.GA_CLIENT_EMAIL, env.GA_PRIVATE_KEY);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  if (!response.ok) {
    throw new Error(`Google OAuth token request failed with status ${response.status}.`);
  }

  const tokenData = await response.json();
  if (typeof tokenData.access_token !== "string") {
    throw new Error("Google OAuth response did not contain an access token.");
  }

  return tokenData.access_token;
};

const getAnalyticsReport = async (env) => {
  const requiredValues = ["GA_CLIENT_EMAIL", "GA_PRIVATE_KEY", "GA_PROPERTY_ID"];
  const missingValue = requiredValues.find((name) => !env[name]);
  if (missingValue) {
    throw new Error(`Missing required Worker secret: ${missingValue}.`);
  }
  if (!/^\d+$/.test(env.GA_PROPERTY_ID)) {
    throw new Error("GA_PROPERTY_ID must be a numeric Google Analytics property ID.");
  }

  const startDate = env.GA_REPORT_START_DATE || "2020-01-01";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error("GA_REPORT_START_DATE must use YYYY-MM-DD.");
  }

  const accessToken = await getAccessToken(env);
  const response = await fetch(
    `${ANALYTICS_URL}/properties/${encodeURIComponent(env.GA_PROPERTY_ID)}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate: "today" }],
        dimensions: [{ name: "country" }, { name: "countryId" }],
        metrics: [{ name: "totalUsers" }],
        metricAggregations: ["TOTAL"],
        orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
        limit: 250
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Google Analytics report request failed with status ${response.status}.`);
  }

  return { report: await response.json(), startDate };
};

const jsonResponse = (payload, status, extraHeaders = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    if (url.pathname !== "/api/visitor-stats") {
      return jsonResponse({ error: "Not found." }, 404);
    }

    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed." }, 405, { Allow: "GET, OPTIONS" });
    }

    try {
      const { report, startDate } = await getAnalyticsReport(env);
      const totalValue = report.totals?.[0]?.metricValues?.[0]?.value;
      const rows = Array.isArray(report.rows) ? report.rows : [];
      let totalVisitors = 0;
      if (totalValue !== undefined || rows.length > 0) {
        if (typeof totalValue !== "string" || !/^\d+$/.test(totalValue)) {
          throw new Error("Google Analytics did not return a total user count.");
        }

        totalVisitors = Number(totalValue);
      }

      if (!Number.isSafeInteger(totalVisitors) || totalVisitors < 0) {
        throw new Error("Google Analytics returned an invalid total user count.");
      }

      const countries = rows
        .map((row) => ({
          country: row.dimensionValues?.[0]?.value,
          countryCode: row.dimensionValues?.[1]?.value,
          visitors: Number(row.metricValues?.[0]?.value)
        }))
        .filter(
          (country) =>
            typeof country.country === "string" &&
            typeof country.countryCode === "string" &&
            Number.isSafeInteger(country.visitors) &&
            country.visitors >= 0
        );

      return jsonResponse(
        {
          totalVisitors,
          startDate,
          updatedAt: new Date().toISOString(),
          countries
        },
        200,
        {
          "Cache-Control": "public, max-age=900, s-maxage=3600, stale-while-revalidate=86400"
        }
      );
    } catch (error) {
      console.error(
        "Visitor statistics could not be retrieved.",
        error instanceof Error ? error.message : "Unknown error"
      );
      return jsonResponse({ error: "Visitor statistics are temporarily unavailable." }, 503);
    }
  }
};
