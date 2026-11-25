# Running on Oracle Cloud Infrastructure

The service is a single stateless container with an Oracle database behind it,
so every OCI compute option works. Pick by how much the client already runs
there.

## Container Instances - the usual choice

No cluster to operate; one container, one public or private endpoint.

```bash
# 1. Push the image to OCI Registry
docker build -t ocir.eu-frankfurt-1.oci.oraclecloud.com/<tenancy>/una-efactura:1.0.0 -f deploy/Dockerfile .
docker push ocir.eu-frankfurt-1.oci.oraclecloud.com/<tenancy>/una-efactura:1.0.0

# 2. Create the instance (console: Developer Services > Container Instances)
#    - image:     the tag above
#    - port:      8090
#    - shape:     CI.Standard.E4.Flex, 1 OCPU / 4 GB is ample
#    - subnet:    the private subnet that can reach the database
```

Set the environment from Vault rather than in the instance definition:
`EFACT__SFS__PASSWORD`, `EFACT__ORACLE__PASSWORD` and
`EFACT__SIGNING__PKCS12__PASSPHRASE` should be Vault secrets injected as
environment variables.

## Autonomous Database

Thin mode connects to ADB over TLS without a wallet when the database is
configured for one-way TLS:

```
EFACT__ORACLE__CONNECTSTRING=(description=(retry_count=20)(retry_delay=3)(address=(protocol=tcps)(port=1521)(host=adb.eu-frankfurt-1.oraclecloud.com))(connect_data=(service_name=<service>))(security=(ssl_server_dn_match=yes)))
```

With mutual TLS, mount the wallet and add `EFACT__ORACLE__WALLETLOCATION` - see
`docs/DEPLOY.md`.

## OKE

Use the same image. The service is stateless, so a plain Deployment with one
replica is enough; the outbox uses `FOR UPDATE SKIP LOCKED`, so more than one
replica is safe if throughput ever needs it.

```yaml
readinessProbe:
  httpGet: { path: /efactura/v1/ready, port: 8090 }
livenessProbe:
  httpGet: { path: /efactura/v1/health, port: 8090 }
```

## Egress

The service needs to reach exactly two hosts:

| Host | Why |
|---|---|
| `efactura-api.sfs.md:443` | the e-Factura API |
| the PKI-Server host | only when `signing.mode` is `pkiserver` |

Everything else can stay closed.
