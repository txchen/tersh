#!/usr/bin/env node
import { runCommand } from "../src/command-runner.js";

process.exitCode = await runCommand(process.argv.slice(2));
