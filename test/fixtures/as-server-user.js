// Preloaded (node --require) by the tests of lib/update-install.js: the recorder and the cleanup run only as
// the server's user, 60000, which no test is. Nothing else changes.
process.getuid = () => 60000;
