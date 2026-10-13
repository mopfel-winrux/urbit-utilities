#!/bin/bash
# Log in to the ship and print the urbauth cookie. usage: tools/get-cookie.sh [port=8081] [code]
# Fake ~zod's +code is lidlut-tabwed-pillex-ridrup; on any ship run +code in the dojo.
PORT=${1:-8081}; CODE=${2:-lidlut-tabwed-pillex-ridrup}
curl -s -i "http://localhost:$PORT/~/login" -X POST -d "password=$CODE" | grep -io 'urbauth-~[a-z-]*=[0-9a-z.v]*' | head -1
