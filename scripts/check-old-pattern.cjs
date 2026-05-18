#!/usr/bin/env node
const fs = require('fs');
const {execSync} = require('child_process');
const searchCmd = `grep -rl "jest.mock.*['\\\"]fs['\\\"], () =>" tests/ | grep -v fsMock\\.ts`;
const files = execSync(searchCmd, {encoding:'utf8'}).split('\n').filter(Boolean);
console.log('Files with OLD inline pattern:', files.length);
files.forEach(f => console.log(' ', f));