#!/bin/bash

PACKAGE_NAME="examine-anywhere.zip"
zip -r "$PACKAGE_NAME" ./* -x "README.md" "make_package.sh"

echo "Package created: $PACKAGE_NAME"