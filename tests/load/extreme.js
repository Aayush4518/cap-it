import http from "k6/http"
import { check, sleep } from "k6"

http.setResponseCallback(http.expectedStatuses(200, 429))

export const options = {
  vus: 500,
  duration: "10s",
  thresholds: {
    checks: ["rate>0.99"],
  },
}

const apiUrl = __ENV.API_URL ?? "http://localhost:3000"

export default function () {
  const response = http.get(`${apiUrl}/demo`, {
    headers: {
      "x-api-key": __ENV.CAPIT_API_KEY,
    },
  })

  check(response, {
    "status is 200 or 429": (res) => res.status === 200 || res.status === 429,
  })

  sleep(1)
}
