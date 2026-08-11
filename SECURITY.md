# Security policy

## Supported use

Lanternwatch is designed for trusted local use on `127.0.0.1`. Its API routes
do not authenticate requests and can return agent activity and local storage
diagnostics. Do not deploy the current application to a public host or expose
it through a tunnel or reverse proxy.

## Reporting a vulnerability

For non-sensitive problems, open a GitHub issue with reproduction steps and
the affected version. Do not include credentials, private activity data,
filesystem contents, or other secrets in a public issue. For sensitive reports,
contact the repository owner privately through their GitHub profile before
sharing details.
