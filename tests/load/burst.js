import http from "k6/http"
import { check, sleep } from "k6"

http.setResponseCallback(http.expectedStatuses(200, 429))

export const options = {
  stages: [
    { duration: "2s", target: 2 },
    { duration: "1s", target: 10 },
    { duration: "5s", target: 10 },
    { duration: "2s", target: 0 },
  ],
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