import { type NextRequest, NextResponse } from "next/server";

const dashboardAuthEnabled = process.env.DASHBOARD_AUTH_ENABLED !== "false";
const cookieName = process.env.AUTH_COOKIE_NAME ?? "signalpilot_session";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!dashboardAuthEnabled) {
    return NextResponse.next();
  }

  const isLoginPage = pathname === "/login";
  const isDashboardRoute = pathname.startsWith("/dashboard") || pathname === "/";
  const hasSession = Boolean(request.cookies.get(cookieName)?.value);

  if (isDashboardRoute && !hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoginPage && hasSession) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/login"]
};
