# Cap-It Benchmark Results

A snapshot of Cap-It’s local k6 runs. All runs used Docker Compose, two API instances, and shared Redis.

| Test | Peak VUs | Duration | Requests | Throughput | HTTP failures | Average latency | p95 latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 2 | 10s | 20 | 1.99 req/s | 0% | 2.24 ms | 3.12 ms |
| Burst | 10 | 10s | 73 | 7.10 req/s | 0% | 2.00 ms | 3.80 ms |
| Heavy | 100 | 10s | 1,000 | 98.81 req/s | 0% | 6.20 ms | 42.64 ms |
| Stress | 20 | 40s | 452 | 11.16 req/s | 0% | 1.56 ms | 3.00 ms |
| Extreme | 500 | 10s | 5,000 | 478.03 req/s | 0% | 10.99 ms | 95.76 ms |
| Extreme (distributed) | 500 | 45s | 12,461 | 269.82 req/s | 0% | 1.33 ms | 2.64 ms |

## Notes

- All six runs had **0% HTTP request failures**.
- The distributed extreme run completed **12,461 requests** across two API instances, with **500 peak VUs**.
- k6 treated both **200** and **429** as expected responses. A successful check does not necessarily mean the request was allowed.
- These are local test results, not a measure of production capacity. The test profiles differ, so the results are not a direct like-for-like comparison.
