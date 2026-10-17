import { SECURITY_HEADERS } from "./lib/securityHeaders";

export default {
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};
