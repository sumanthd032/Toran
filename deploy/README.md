# deploy

The deployed hall is one program: Toran Core serving the built Twin, its API,
the Curator Console and the simulated visitors, on one port. It is the same
program `npm start` runs on a laptop, so what you see on localhost is what the
deployment serves.

## Build it, on the machine that has the archive

`data/` and the export are made from sources that are not in the repository,
so the image is built where they are:

```sh
npm run build:data        # once, and again when the sources change
npm run build:hall        # the export, set to find Core at its own origin
npm start                 # optional: the deployed hall, at http://127.0.0.1:8787/
npm run verify:hall       # the same checks the deployment will get
docker build -f deploy/Dockerfile -t toran-hall .
```

The image is about 1.4 GB on top of the Node base image: 919 MB of `data/`
(620 MB of it the original sources, kept so fixity can be checked) and 427 MB of
export, most of which is the embedding model and the two films.

## Run it anywhere with Docker

```sh
cp deploy/toran.env.example deploy/toran.env     # fill in; never commit it
docker run -d --name toran --restart unless-stopped \
  -p 127.0.0.1:8787:8787 --env-file deploy/toran.env \
  -v toran-data:/srv/toran/data toran-hall
```

`toran-data` holds what curators decide and the card sessions. It outlives
the container: a new image started on the same volume serves every decision in
it, because the entrypoint rebuilds the archive from the curation logs first.

## On AWS

AWS was chosen for hosting on 2026-09-26, on the project's free credits. AWS
needs a card, and bills once the credits are spent, so set a budget alarm
before anything else. The steps below were written against the files here and
have not been run on AWS.

1. **Budget.** Billing, Budgets, a monthly budget with an alert well under the
   credit balance.
2. **Instance.** EC2, Ubuntu 24.04, `t3.small` (2 GB). Core used 74 MB in the
   container after serving a film three times; the Twin itself runs in the
   visitor's browser. A 20 GB gp3 disk leaves room
   for two images. Security group: 22 from your address only, and 80 and 443
   from anywhere. Port 8787 stays closed, because Caddy is the way in.
3. **Docker and Caddy** on the instance:
   `sudo apt install -y docker.io caddy`
4. **The image.** The archive is not in git, so copy the built image rather
   than building on the instance:
   `docker save toran-hall | gzip | ssh ubuntu@HOST 'gunzip | sudo docker load'`
5. **Secrets.** Copy `deploy/toran.env` to the instance and set
   `TORAN_CORE_ORIGINS` to the public address.
6. **Run.** The `docker run` above, on the instance.
7. **HTTPS.** Point a domain at the instance, put the domain in
   `deploy/Caddyfile`, copy it to `/etc/caddy/Caddyfile`, and
   `sudo systemctl reload caddy`. Without HTTPS the hall works, but browsers
   will not let a page off the machine use the microphone, so no spoken
   queries are offered there.
8. **Check.** From your machine: `HALL_URL=https://your.domain npm run verify:hall`.

## Without Docker

`deploy/toran.service` runs the same thing from a checkout at `/opt/toran`
(with `data/` and `apps/web/out` copied in), under systemd, behind the same
Caddyfile. The environment goes in `/etc/toran/core.env`.

## As deployed

The hall runs at **https://toran-hall.duckdns.org**, since 2026-09-27.

| | |
| --- | --- |
| Instance | EC2 `t3.small`, `ap-south-1`, Ubuntu 24.04, 20 GB gp3, tagged `project=toran` |
| Instance id | `i-09b47ce8b3a225ad4` |
| Access | SSH as `ubuntu`, port 22 open to the owner's IP only; with the key pair `toran-hall.pem`, or with EC2 Instance Connect (below) |
| Container | `toran`, restarting unless stopped, volume `toran-data` |
| HTTPS | Caddy, from `/etc/caddy/Caddyfile`, with a Let's Encrypt certificate |
| Secrets | `/srv/toran/toran.env`, mode 600, from `deploy/toran.env` on the build machine |
| Budget | `toran-hall`, 10 USD a month, emails at 50 percent actual and 100 percent forecast |

The name is DuckDNS, pointed at the instance's public IP by hand. That IP stays
through a reboot, but a **stop and start gives the instance a new one**, and
DuckDNS then has to be updated with its token. The deployed hall's curator key
is its own, in `deploy/toran.env`, and not the one in `.env.local`.

### Getting in without the .pem

A machine that has the AWS CLI logged in to the account, but not
`toran-hall.pem`, can push its own public key to the instance. The key is
accepted for 60 seconds, so push it right before each `ssh`; a connection
opened in that window stays open.

```sh
aws ec2-instance-connect send-ssh-public-key --region ap-south-1 \
  --instance-id i-09b47ce8b3a225ad4 --instance-os-user ubuntu \
  --ssh-public-key file://$HOME/.ssh/id_ed25519.pub
ssh ubuntu@toran-hall.duckdns.org
```

The instance's ED25519 host key is
`SHA256:Dfiyi8et0RjnYcneKV/jn++jWBHn9anfv2sX7zj6a2w`. Check it before trusting
the host for the first time; cloud-init prints it in
`aws ec2 get-console-output --region ap-south-1 --instance-id i-09b47ce8b3a225ad4 --latest`.
A new instance has a new key.

### Shipping a new build

On the build machine. Docker needs the user in the `docker` group; the image
is about 1.25 GB to send.

```sh
npm run build:hall
docker build -f deploy/Dockerfile -t toran-hall .
docker images toran-hall                  # note the image id
docker save toran-hall | gzip -1 | ssh ubuntu@toran-hall.duckdns.org 'gunzip | sudo docker load'
```

Then on the instance, confirm `sudo docker images toran-hall` shows the same
id, and replace the container:

```sh
sudo docker rm -f toran
sudo docker run -d --name toran --restart unless-stopped -p 127.0.0.1:8787:8787 \
  --env-file /srv/toran/toran.env -v toran-data:/srv/toran/data toran-hall
sudo docker image prune -f                # the old image, now untagged
```

Each image is 2.9 GB on the 20 GB disk, so prune after every ship. Two old
images had built up by 2026-09-28 and pruning them freed 2.3 GB.

Then check it: `HALL_URL=https://toran-hall.duckdns.org npm run verify:hall`.
