# 실제 PostgreSQL 17 실행 증거

2026-10-19 KST. T01~T18은 각기 새 network=none 컨테이너에서 실행했다. 아래 값은 실제 실행 결과 JSON에서 추출했다. nonce는 격리 표식이며 인증 토큰이 아니다. 대상 컨테이너와 volume은 모두 정리됐다.

| Test | Result | 사후 이력 수 | 사후 support tables |
|---|---|---|---|
| T01 normal migration and default dry-run | PASS | 5 | 5 |
| T02 ledger source checksum and audit | PASS | 5 | 5 |
| T03 preserve four complete legacy rows | PASS | 7 | 10 |
| T04 refuse duplicate version | PASS | 5 | 5 |
| T05 refuse reverse order | PASS | 4 | 0 |
| T06 fail midway through SQL and retry | PASS | 5 | 5 |
| T07 ledger INSERT failure rolls back DDL | PASS | 4 | 0 |
| T08 connection termination before COMMIT | PASS | 4 | 0 |
| T09 concurrent identical and different migrations | PASS | 6 | 10 |
| T10 fail closed when advisory lock held | PASS | 4 | 0 |
| T11 reject checksum mismatch without editing migrations | PASS | 4 | 0 |
| T12 reject unexpected existing objects | PASS | 4 | 1 |
| T13 reject production IDs and forged server identity | PASS | 4 | 0 |
| T14 reject connection strings and ignore production environment | PASS | 4 | 0 |
| T15 preserve full authentication functions and synthetic sessions | PASS | 7 | 10 |
| T16 preserve Collector and article objects and data | PASS | 7 | 10 |
| T17 execute complete ordered chain | PASS | 7 | 10 |
| T18 exactly seven ledger rows and drift rejection | PASS | 7 | 10 |

## T01

```json
{
  "name": "T01 normal migration and default dry-run",
  "result": "PASS",
  "target": {
    "container": "673b95c7136e44f19feb24bdb92e3b6782748df715d7698b1482c9f7055a2c64",
    "host": "container-local-unix-socket",
    "port": 5432,
    "database": "medical_mb006_ledger",
    "system": "7698273941394153512",
    "oid": "16384",
    "version": "170006",
    "network": "none",
    "project": "synthetic-local-only"
  },
  "observed": {
    "versions": [
      "20260928064906",
      "20260929063328",
      "20261007041102",
      "20261012043225",
      "20261016014502"
    ],
    "support_tables": 5
  },
  "audit": [
    {
      "at": "2026-10-19T07:14:38.262Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "validate",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:14:38.264Z",
      "event": "DRY_RUN",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "validate",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:14:38.753Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:14:38.979Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 5,
        "applied": [
          "20261016014502"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    }
  ],
  "cleanup": "own container and volume removed"
}
```

## T02

```json
{
  "name": "T02 ledger source checksum and audit",
  "result": "PASS",
  "target": {
    "container": "96356a1645b5468bf8c4069d76bb36703ca58453d582a472cbf124a52b2f04ca",
    "host": "container-local-unix-socket",
    "port": 5432,
    "database": "medical_mb006_ledger",
    "system": "7698273953603731498",
    "oid": "16384",
    "version": "170006",
    "network": "none",
    "project": "synthetic-local-only"
  },
  "observed": {
    "versions": [
      "20260928064906",
      "20260929063328",
      "20261007041102",
      "20261012043225",
      "20261016014502"
    ],
    "support_tables": 5
  },
  "audit": [
    {
      "at": "2026-10-19T07:14:41.069Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:14:41.316Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 5,
        "applied": [
          "20261016014502"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    }
  ],
  "cleanup": "own container and volume removed"
}
```

## T03

```json
{
  "name": "T03 preserve four complete legacy rows",
  "result": "PASS",
  "target": {
    "container": "fb0fde2feb8fa2eaf8c9a8a67c1a978d311c8086cd978af3c5e4e0de2dfda2bc",
    "host": "container-local-unix-socket",
    "port": 5432,
    "database": "medical_mb006_ledger",
    "system": "7698273963463368744",
    "oid": "16384",
    "version": "170006",
    "network": "none",
    "project": "synthetic-local-only"
  },
  "observed": {
    "versions": [
      "20260928064906",
      "20260929063328",
      "20261007041102",
      "20261012043225",
      "20261016014502",
      "20261016035115",
      "20261019041429"
    ],
    "support_tables": 10
  },
  "audit": [
    {
      "at": "2026-10-19T07:14:43.446Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:14:43.687Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 5,
        "applied": [
          "20261016014502"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:14:43.932Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016035115",
      "sha256": "6c462bbf80b8469856be36d52c506e0372f6eb539c2551d0610b24226cacbd8b",
      "mode": "apply",
      "history": {
        "count": 5,
        "applied": [
          "20261016014502"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:14:44.153Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261016035115",
      "sha256": "6c462bbf80b8469856be36d52c506e0372f6eb539c2551d0610b24226cacbd8b",
      "mode": "apply",
      "history": {
        "count": 6,
        "applied": [
          "20261016014502",
          "20261016035115"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:14:44.393Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261019041429",
      "sha256": "610a8328a118e4c457acafb81fcdd28a3993efcd770f412ca7a04cdf4bf05da1",
      "mode": "apply",
      "history": {
        "count": 6,
        "applied": [
          "20261016014502",
          "20261016035115"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:14:44.640Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261019041429",
      "sha256": "610a8328a118e4c457acafb81fcdd28a3993efcd770f412ca7a04cdf4bf05da1",
      "mode": "apply",
      "history": {
        "count": 7,
        "applied": [
          "20261016014502",
          "20261016035115",
          "20261019041429"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    }
  ],
  "cleanup": "own container and volume removed"
}
```

## T04

```json
{
  "name": "T04 refuse duplicate version",
  "result": "PASS",
  "target": {
    "container": "95c379224590e38b827397a7bee3cd8ac954ea21f4211c749e1b18b6da175a40",
    "host": "container-local-unix-socket",
    "port": 5432,
    "database": "medical_mb006_ledger",
    "system": "7698273977934356521",
    "oid": "16384",
    "version": "170006",
    "network": "none",
    "project": "synthetic-local-only"
  },
  "observed": {
    "versions": [
      "20260928064906",
      "20260929063328",
      "20261007041102",
      "20261012043225",
      "20261016014502"
    ],
    "support_tables": 5
  },
  "audit": [
    {
      "at": "2026-10-19T07:14:46.756Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:14:46.997Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 5,
        "applied": [
          "20261016014502"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:14:47.246Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 5,
        "applied": [
          "20261016014502"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:14:47.247Z",
      "event": "REJECTED_DUPLICATE",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply"
    }
  ],
  "cleanup": "own container and volume removed"
}
```

## T05

```json
{
  "name": "T05 refuse reverse order",
  "result": "PASS",
  "target": {
    "container": "05fa95cd28a738b555134979cf762034cf1cb327ad2d04746402ba8fb283c4cc",
    "host": "container-local-unix-socket",
    "port": 5432,
    "database": "medical_mb006_ledger",
    "system": "7698273989557137448",
    "oid": "16384",
    "version": "170006",
    "network": "none",
    "project": "synthetic-local-only"
  },
  "observed": {
    "versions": [
      "20260928064906",
      "20260929063328",
      "20261007041102",
      "20261012043225"
    ],
    "support_tables": 0
  },
  "audit": [
    {
      "at": "2026-10-19T07:14:49.491Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016035115",
      "sha256": "6c462bbf80b8469856be36d52c506e0372f6eb539c2551d0610b24226cacbd8b",
      "mode": "apply",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:14:49.492Z",
      "event": "REJECTED_ORDER",
      "version": "20261016035115",
      "sha256": "6c462bbf80b8469856be36d52c506e0372f6eb539c2551d0610b24226cacbd8b",
      "mode": "apply"
    },
    {
      "at": "2026-10-19T07:14:49.730Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261019041429",
      "sha256": "610a8328a118e4c457acafb81fcdd28a3993efcd770f412ca7a04cdf4bf05da1",
      "mode": "apply",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:14:49.730Z",
      "event": "REJECTED_ORDER",
      "version": "20261019041429",
      "sha256": "610a8328a118e4c457acafb81fcdd28a3993efcd770f412ca7a04cdf4bf05da1",
      "mode": "apply"
    }
  ],
  "cleanup": "own container and volume removed"
}
```

## T06

```json
{
  "name": "T06 fail midway through SQL and retry",
  "result": "PASS",
  "target": {
    "container": "84a9a84df1a6b778112b5049fed0258de76e8973457da9836518356e1f84cb5c",
    "host": "container-local-unix-socket",
    "port": 5432,
    "database": "medical_mb006_ledger",
    "system": "7698274000630276138",
    "oid": "16384",
    "version": "170006",
    "network": "none",
    "project": "synthetic-local-only"
  },
  "observed": {
    "versions": [
      "20260928064906",
      "20260929063328",
      "20261007041102",
      "20261012043225",
      "20261016014502"
    ],
    "support_tables": 5
  },
  "audit": [
    {
      "at": "2026-10-19T07:14:52.097Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:14:52.156Z",
      "event": "FAILED_RECONCILE_BEFORE_RETRY",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply"
    },
    {
      "at": "2026-10-19T07:14:52.713Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:14:52.967Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 5,
        "applied": [
          "20261016014502"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    }
  ],
  "cleanup": "own container and volume removed"
}
```

## T07

```json
{
  "name": "T07 ledger INSERT failure rolls back DDL",
  "result": "PASS",
  "target": {
    "container": "1fb03662c58b2c75b99fbbb7114f1b1ca17d82f0dc9680d1751e101dfb93bc25",
    "host": "container-local-unix-socket",
    "port": 5432,
    "database": "medical_mb006_ledger",
    "system": "7698274013971116072",
    "oid": "16384",
    "version": "170006",
    "network": "none",
    "project": "synthetic-local-only"
  },
  "observed": {
    "versions": [
      "20260928064906",
      "20260929063328",
      "20261007041102",
      "20261012043225"
    ],
    "support_tables": 0
  },
  "audit": [
    {
      "at": "2026-10-19T07:14:55.220Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:14:55.290Z",
      "event": "FAILED_RECONCILE_BEFORE_RETRY",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply"
    }
  ],
  "cleanup": "own container and volume removed"
}
```

## T08

```json
{
  "name": "T08 connection termination before COMMIT",
  "result": "PASS",
  "target": {
    "container": "f916710f85aa3021e2d169e5325b83e6917c42c3ead95a6149c142c07d85bef7",
    "host": "container-local-unix-socket",
    "port": 5432,
    "database": "medical_mb006_ledger",
    "system": "7698274024083144745",
    "oid": "16384",
    "version": "170006",
    "network": "none",
    "project": "synthetic-local-only"
  },
  "observed": {
    "versions": [
      "20260928064906",
      "20260929063328",
      "20261007041102",
      "20261012043225"
    ],
    "support_tables": 0
  },
  "audit": [
    {
      "at": "2026-10-19T07:14:57.492Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:14:57.715Z",
      "event": "FAILED_RECONCILE_BEFORE_RETRY",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply"
    }
  ],
  "cleanup": "own container and volume removed"
}
```

## T09

```json
{
  "name": "T09 concurrent identical and different migrations",
  "result": "PASS",
  "target": {
    "container": "e86b18009b8d935850cec1854adaabd2328628a21f67ac838f72cb2074a55367",
    "host": "container-local-unix-socket",
    "port": 5432,
    "database": "medical_mb006_ledger",
    "system": "7698274034579443753",
    "oid": "16384",
    "version": "170006",
    "network": "none",
    "project": "synthetic-local-only"
  },
  "observed": {
    "versions": [
      "20260928064906",
      "20260929063328",
      "20261007041102",
      "20261012043225",
      "20261016014502",
      "20261016035115"
    ],
    "support_tables": 10
  },
  "audit": [
    {
      "at": "2026-10-19T07:15:00.328Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:00.328Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:00.396Z",
      "event": "FAILED_RECONCILE_BEFORE_RETRY",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply"
    },
    {
      "at": "2026-10-19T07:15:01.111Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 5,
        "applied": [
          "20261016014502"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:01.533Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016035115",
      "sha256": "6c462bbf80b8469856be36d52c506e0372f6eb539c2551d0610b24226cacbd8b",
      "mode": "apply",
      "history": {
        "count": 5,
        "applied": [
          "20261016014502"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:01.971Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261019041429",
      "sha256": "610a8328a118e4c457acafb81fcdd28a3993efcd770f412ca7a04cdf4bf05da1",
      "mode": "apply",
      "history": {
        "count": 5,
        "applied": [
          "20261016014502"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:01.972Z",
      "event": "REJECTED_ORDER",
      "version": "20261019041429",
      "sha256": "610a8328a118e4c457acafb81fcdd28a3993efcd770f412ca7a04cdf4bf05da1",
      "mode": "apply"
    },
    {
      "at": "2026-10-19T07:15:02.299Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261016035115",
      "sha256": "6c462bbf80b8469856be36d52c506e0372f6eb539c2551d0610b24226cacbd8b",
      "mode": "apply",
      "history": {
        "count": 6,
        "applied": [
          "20261016014502",
          "20261016035115"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    }
  ],
  "cleanup": "own container and volume removed"
}
```

## T10

```json
{
  "name": "T10 fail closed when advisory lock held",
  "result": "PASS",
  "target": {
    "container": "ab2d1ade2268e32065ee037678e511e27d48d48e288b70c802cc99e8f02dad03",
    "host": "container-local-unix-socket",
    "port": 5432,
    "database": "medical_mb006_ledger",
    "system": "7698274054425026602",
    "oid": "16384",
    "version": "170006",
    "network": "none",
    "project": "synthetic-local-only"
  },
  "observed": {
    "versions": [
      "20260928064906",
      "20260929063328",
      "20261007041102",
      "20261012043225"
    ],
    "support_tables": 0
  },
  "audit": [
    {
      "at": "2026-10-19T07:15:04.640Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:04.688Z",
      "event": "FAILED_RECONCILE_BEFORE_RETRY",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply"
    }
  ],
  "cleanup": "own container and volume removed"
}
```

## T11

```json
{
  "name": "T11 reject checksum mismatch without editing migrations",
  "result": "PASS",
  "target": {
    "container": "8abf4d1c3a58a9eba35462a4d100b96c7fb25fdab3ef9f5dd6075935917ab49d",
    "host": "container-local-unix-socket",
    "port": 5432,
    "database": "medical_mb006_ledger",
    "system": "7698274064869842985",
    "oid": "16384",
    "version": "170006",
    "network": "none",
    "project": "synthetic-local-only"
  },
  "observed": {
    "versions": [
      "20260928064906",
      "20260929063328",
      "20261007041102",
      "20261012043225"
    ],
    "support_tables": 0
  },
  "audit": [],
  "cleanup": "own container and volume removed"
}
```

## T12

```json
{
  "name": "T12 reject unexpected existing objects",
  "result": "PASS",
  "target": {
    "container": "aa8ccf7b4781581189ed5adfd9bae1754e678d5fb7b8aa2cb2abf84b31027577",
    "host": "container-local-unix-socket",
    "port": 5432,
    "database": "medical_mb006_ledger",
    "system": "7698274073335980071",
    "oid": "16384",
    "version": "170006",
    "network": "none",
    "project": "synthetic-local-only"
  },
  "observed": {
    "versions": [
      "20260928064906",
      "20260929063328",
      "20261007041102",
      "20261012043225"
    ],
    "support_tables": 1
  },
  "audit": [
    {
      "at": "2026-10-19T07:15:09.045Z",
      "event": "REJECTED_STATE",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "code": "OBJECT_LEDGER_MISMATCH"
    }
  ],
  "cleanup": "own container and volume removed"
}
```

## T13

```json
{
  "name": "T13 reject production IDs and forged server identity",
  "result": "PASS",
  "target": {
    "container": "cb60a0fae7e67a0fc1dd311fe5a3043adfe5110916437923a5852568c9addd46",
    "host": "container-local-unix-socket",
    "port": 5432,
    "database": "medical_mb006_ledger",
    "system": "7698274082709643304",
    "oid": "16384",
    "version": "170006",
    "network": "none",
    "project": "synthetic-local-only"
  },
  "observed": {
    "versions": [
      "20260928064906",
      "20260929063328",
      "20261007041102",
      "20261012043225"
    ],
    "support_tables": 0
  },
  "audit": [],
  "cleanup": "own container and volume removed"
}
```

## T14

```json
{
  "name": "T14 reject connection strings and ignore production environment",
  "result": "PASS",
  "target": {
    "container": "f9ec14c9c3ae41a86bc42c490d9f55eec21abdcf450dd1f86068b08f5f2bdb96",
    "host": "container-local-unix-socket",
    "port": 5432,
    "database": "medical_mb006_ledger",
    "system": "7698274092744118314",
    "oid": "16384",
    "version": "170006",
    "network": "none",
    "project": "synthetic-local-only"
  },
  "observed": {
    "versions": [
      "20260928064906",
      "20260929063328",
      "20261007041102",
      "20261012043225"
    ],
    "support_tables": 0
  },
  "audit": [
    {
      "at": "2026-10-19T07:15:13.443Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "validate",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:13.444Z",
      "event": "DRY_RUN",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "validate",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    }
  ],
  "cleanup": "own container and volume removed"
}
```

## T15

```json
{
  "name": "T15 preserve full authentication functions and synthetic sessions",
  "result": "PASS",
  "target": {
    "container": "5a73e4d2f97caeab62ed9476a3c4cd0ade2d296919bef29021959cc677347490",
    "host": "container-local-unix-socket",
    "port": 5432,
    "database": "medical_mb006_ledger",
    "system": "7698274102258778152",
    "oid": "16384",
    "version": "170006",
    "network": "none",
    "project": "synthetic-local-only"
  },
  "observed": {
    "versions": [
      "20260928064906",
      "20260929063328",
      "20261007041102",
      "20261012043225",
      "20261016014502",
      "20261016035115",
      "20261019041429"
    ],
    "support_tables": 10
  },
  "audit": [
    {
      "at": "2026-10-19T07:15:15.743Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:15.983Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 5,
        "applied": [
          "20261016014502"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:16.226Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016035115",
      "sha256": "6c462bbf80b8469856be36d52c506e0372f6eb539c2551d0610b24226cacbd8b",
      "mode": "apply",
      "history": {
        "count": 5,
        "applied": [
          "20261016014502"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:16.466Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261016035115",
      "sha256": "6c462bbf80b8469856be36d52c506e0372f6eb539c2551d0610b24226cacbd8b",
      "mode": "apply",
      "history": {
        "count": 6,
        "applied": [
          "20261016014502",
          "20261016035115"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:16.709Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261019041429",
      "sha256": "610a8328a118e4c457acafb81fcdd28a3993efcd770f412ca7a04cdf4bf05da1",
      "mode": "apply",
      "history": {
        "count": 6,
        "applied": [
          "20261016014502",
          "20261016035115"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:16.973Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261019041429",
      "sha256": "610a8328a118e4c457acafb81fcdd28a3993efcd770f412ca7a04cdf4bf05da1",
      "mode": "apply",
      "history": {
        "count": 7,
        "applied": [
          "20261016014502",
          "20261016035115",
          "20261019041429"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    }
  ],
  "cleanup": "own container and volume removed"
}
```

## T16

```json
{
  "name": "T16 preserve Collector and article objects and data",
  "result": "PASS",
  "target": {
    "container": "faaf6314052721f35174c927ee3442cc995083d0b4388f08db0c891414364e05",
    "host": "container-local-unix-socket",
    "port": 5432,
    "database": "medical_mb006_ledger",
    "system": "7698274116799299625",
    "oid": "16384",
    "version": "170006",
    "network": "none",
    "project": "synthetic-local-only"
  },
  "observed": {
    "versions": [
      "20260928064906",
      "20260929063328",
      "20261007041102",
      "20261012043225",
      "20261016014502",
      "20261016035115",
      "20261019041429"
    ],
    "support_tables": 10
  },
  "audit": [
    {
      "at": "2026-10-19T07:15:19.156Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:19.414Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 5,
        "applied": [
          "20261016014502"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:19.652Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016035115",
      "sha256": "6c462bbf80b8469856be36d52c506e0372f6eb539c2551d0610b24226cacbd8b",
      "mode": "apply",
      "history": {
        "count": 5,
        "applied": [
          "20261016014502"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:19.892Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261016035115",
      "sha256": "6c462bbf80b8469856be36d52c506e0372f6eb539c2551d0610b24226cacbd8b",
      "mode": "apply",
      "history": {
        "count": 6,
        "applied": [
          "20261016014502",
          "20261016035115"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:20.135Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261019041429",
      "sha256": "610a8328a118e4c457acafb81fcdd28a3993efcd770f412ca7a04cdf4bf05da1",
      "mode": "apply",
      "history": {
        "count": 6,
        "applied": [
          "20261016014502",
          "20261016035115"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:20.370Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261019041429",
      "sha256": "610a8328a118e4c457acafb81fcdd28a3993efcd770f412ca7a04cdf4bf05da1",
      "mode": "apply",
      "history": {
        "count": 7,
        "applied": [
          "20261016014502",
          "20261016035115",
          "20261019041429"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    }
  ],
  "cleanup": "own container and volume removed"
}
```

## T17

```json
{
  "name": "T17 execute complete ordered chain",
  "result": "PASS",
  "target": {
    "container": "341f48a182d9b80e911eec65033edb93b74f050a8edac75fd487283a78387f7b",
    "host": "container-local-unix-socket",
    "port": 5432,
    "database": "medical_mb006_ledger",
    "system": "7698274131444539433",
    "oid": "16384",
    "version": "170006",
    "network": "none",
    "project": "synthetic-local-only"
  },
  "observed": {
    "versions": [
      "20260928064906",
      "20260929063328",
      "20261007041102",
      "20261012043225",
      "20261016014502",
      "20261016035115",
      "20261019041429"
    ],
    "support_tables": 10
  },
  "audit": [
    {
      "at": "2026-10-19T07:15:22.500Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:22.739Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 5,
        "applied": [
          "20261016014502"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:23.131Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016035115",
      "sha256": "6c462bbf80b8469856be36d52c506e0372f6eb539c2551d0610b24226cacbd8b",
      "mode": "apply",
      "history": {
        "count": 5,
        "applied": [
          "20261016014502"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:23.376Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261016035115",
      "sha256": "6c462bbf80b8469856be36d52c506e0372f6eb539c2551d0610b24226cacbd8b",
      "mode": "apply",
      "history": {
        "count": 6,
        "applied": [
          "20261016014502",
          "20261016035115"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:23.786Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261019041429",
      "sha256": "610a8328a118e4c457acafb81fcdd28a3993efcd770f412ca7a04cdf4bf05da1",
      "mode": "apply",
      "history": {
        "count": 6,
        "applied": [
          "20261016014502",
          "20261016035115"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:24.023Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261019041429",
      "sha256": "610a8328a118e4c457acafb81fcdd28a3993efcd770f412ca7a04cdf4bf05da1",
      "mode": "apply",
      "history": {
        "count": 7,
        "applied": [
          "20261016014502",
          "20261016035115",
          "20261019041429"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    }
  ],
  "cleanup": "own container and volume removed"
}
```

## T18

```json
{
  "name": "T18 exactly seven ledger rows and drift rejection",
  "result": "PASS",
  "target": {
    "container": "016caa2bdd6950921c646a49311edb8259f1584853bd53efe3247e147b63ff3f",
    "host": "container-local-unix-socket",
    "port": 5432,
    "database": "medical_mb006_ledger",
    "system": "7698274147703324714",
    "oid": "16384",
    "version": "170006",
    "network": "none",
    "project": "synthetic-local-only"
  },
  "observed": {
    "versions": [
      "20260928064906",
      "20260929063328",
      "20261007041102",
      "20261012043225",
      "20261016014502",
      "20261016035115",
      "20261019041429"
    ],
    "support_tables": 10
  },
  "audit": [
    {
      "at": "2026-10-19T07:15:26.246Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 4,
        "applied": [],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:26.487Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261016014502",
      "sha256": "f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6",
      "mode": "apply",
      "history": {
        "count": 5,
        "applied": [
          "20261016014502"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:26.735Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261016035115",
      "sha256": "6c462bbf80b8469856be36d52c506e0372f6eb539c2551d0610b24226cacbd8b",
      "mode": "apply",
      "history": {
        "count": 5,
        "applied": [
          "20261016014502"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:26.956Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261016035115",
      "sha256": "6c462bbf80b8469856be36d52c506e0372f6eb539c2551d0610b24226cacbd8b",
      "mode": "apply",
      "history": {
        "count": 6,
        "applied": [
          "20261016014502",
          "20261016035115"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:27.196Z",
      "event": "BEGIN_VALIDATION",
      "version": "20261019041429",
      "sha256": "610a8328a118e4c457acafb81fcdd28a3993efcd770f412ca7a04cdf4bf05da1",
      "mode": "apply",
      "history": {
        "count": 6,
        "applied": [
          "20261016014502",
          "20261016035115"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    },
    {
      "at": "2026-10-19T07:15:27.438Z",
      "event": "COMMIT_CONFIRMED",
      "version": "20261019041429",
      "sha256": "610a8328a118e4c457acafb81fcdd28a3993efcd770f412ca7a04cdf4bf05da1",
      "mode": "apply",
      "history": {
        "count": 7,
        "applied": [
          "20261016014502",
          "20261016035115",
          "20261019041429"
        ],
        "legacy": [
          "20260928064906",
          "20260929063328",
          "20261007041102",
          "20261012043225"
        ]
      }
    }
  ],
  "cleanup": "own container and volume removed"
}
```
