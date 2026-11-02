import { NextResponse, type NextRequest } from "next/server";

async function proxyUpstream(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  const subpath = path.join("/");
  const apiOrigin = process.env.API_INTERNAL_ORIGIN ?? "http://localhost:3001";
  const targetUrl = `${apiOrigin}/api/v1/${subpath}${request.nextUrl.search}`;

  const rawBody =
    request.method !== "GET" && request.method !== "HEAD"
      ? await request.text()
      : undefined;

  try {
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const cookie = request.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);

    const upstreamRes = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: rawBody,
      cache: "no-store",
    });

    const bodyText = await upstreamRes.text();
    const resHeaders = new Headers();
    const upstreamContentType = upstreamRes.headers.get("content-type");
    if (upstreamContentType) {
      resHeaders.set("content-type", upstreamContentType);
    }

    const getSetCookie = (
      upstreamRes.headers as unknown as { getSetCookie?: () => string[] }
    ).getSetCookie;
    if (typeof getSetCookie === "function") {
      for (const c of getSetCookie.call(upstreamRes.headers)) {
        resHeaders.append("set-cookie", c);
      }
    } else {
      const setCookie = upstreamRes.headers.get("set-cookie");
      if (setCookie) {
        resHeaders.set("set-cookie", setCookie);
      }
    }

    return new NextResponse(bodyText, {
      status: upstreamRes.status,
      headers: resHeaders,
    });
  } catch {
    return NextResponse.json(
      {
        code: "API_UNAVAILABLE",
        message: "The KarenPay API server is not reachable.",
        spoken:
          "The KarenPay service is currently unavailable. Please try again shortly.",
      },
      { status: 503 },
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return proxyUpstream(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return proxyUpstream(request, context);
}
