#!/bin/sh
# Local testing via NPM link
cd packages/shared
npm link
cd ../server
npm link @yetidevworks/shared
npm run build
npm link
