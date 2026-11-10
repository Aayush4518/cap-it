import http from "k6/http"
import { check, sleep } from "k6"

http.setResponseCallback(http.expectedStatuses(200, 429))

export const options = {
  scenarios: {
    distributed_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        // // { duration: "10s", target: 100 },
        // // { duration: "10s", target: 250 },
        // // { duration: "10s", target: 500 },
        // { duration: "10s", target: 500 },
        { duration: "5s", target: 0 },
      ],
    },
  },
  thresholds: {
    checks: ["rate>0.99"],
  },
}

const api1Url = __ENV.API1_URL ?? "http://localhost:3000"
const api2Url = __ENV.API2_URL ?? "http://localhost:3002"

export default function () {
  const apiUrl = __VU % 2 === 0 ? api1Url : api2Url

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
