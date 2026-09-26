(function () {
  const hostname = window.location.hostname;
  const isLocalFrontend =
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "";
  const isProductionPlatformHost =
    hostname === "hachozeh.com" ||
    hostname === "www.hachozeh.com";
  // Dev/staging subdomains (e.g. dev.hachozeh.com) — same-origin backend like prod,
  // but without the strict auth gates that lock down auth / hide dev OTP.
  const isHachozehSubdomain =
    !isProductionPlatformHost && hostname.endsWith(".hachozeh.com");
  const isPublicPlatformHost = isProductionPlatformHost || isHachozehSubdomain;
  const localBackendHost = hostname === "localhost" ? "localhost" : "127.0.0.1";
  const usesSameOriginBackendProxy =
    isLocalFrontend &&
    (window.location.port === "6969" || window.location.port === "8080");

  if (!window.NAVI_BACKEND_BASE_URL && isLocalFrontend && !usesSameOriginBackendProxy) {
    window.NAVI_BACKEND_BASE_URL = `http://${localBackendHost}:3001`;
  }

  if (!window.NAVI_BACKEND_BASE_URL && isPublicPlatformHost) {
    window.NAVI_BACKEND_BASE_URL = window.location.origin;
  }

  if (window.NAVI_ENABLE_BACKEND_AUTH !== true && (isLocalFrontend || isPublicPlatformHost)) {
    window.NAVI_ENABLE_BACKEND_AUTH = true;
  }

  if (isProductionPlatformHost) {
    window.NAVI_REQUIRE_BACKEND_AUTH = true;
    window.NAVI_SUPPRESS_DEV_OTP = true;
  }

  window.NAVI_REQUIRE_BACKEND_AUTH = window.NAVI_REQUIRE_BACKEND_AUTH === true;
  // Deposit was removed entirely (product/legal: no real money buys V₪) — there is
  // no deposit CTA, overlay, or package code left in the tree. (Nothing to gate.)
  window.NAVI_SUPPRESS_DEV_OTP = window.NAVI_SUPPRESS_DEV_OTP === true;
  window.NAVI_REQUIRE_BACKEND_PORTFOLIO = window.NAVI_REQUIRE_BACKEND_PORTFOLIO === true;
})();
