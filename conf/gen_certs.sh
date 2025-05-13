#!/bin/bash
openssl req -x509 -newkey rsa:4096 -keyout conf/tls.key -out conf/tls.crt -days 365 -nodes -subj "/0=rocket"
