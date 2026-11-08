import http from "k6/http"
import { check, sleep } from "k6"

http.setResponseCallback(http.expectedStatuses(200, 429))

export const options = {
  vus: 2,
  duration: "10s",
  thresholds: {
    checks: ["rate>0.99"],
  },
}

export default function () {
  const response = http.get("http://localhost:3000/demo", {
    headers: {
      "x-api-key": __ENV.CAPIT_API_KEY,
    },
  })

  check(response, {
    "status is 200 or 429": (res) => res.status === 200 || res.status === 429,
  })

  sleep(1)
}