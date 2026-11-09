// Entry for scriptlets/<group>.js. The build wraps this bundle with the group's table:
//   (() => { const __HUSH_TABLE__ = {...}; <this bundle> })();
// so nothing leaks into the page's globals.
import { run, type Table } from "./scriptlets";

declare const __HUSH_TABLE__: Table;
run(__HUSH_TABLE__);
