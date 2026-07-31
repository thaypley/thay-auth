migrate((app) => {
  const sessions = app.findCollectionByNameOrId('sessions');
  sessions.indexes = sessions.indexes.filter((i) => !i.includes('idx_sessions_token'));
  sessions.indexes.push('CREATE INDEX idx_sessions_token ON sessions (tokenHash)');
  app.save(sessions);

  const devices = app.findCollectionByNameOrId('devices');
  devices.indexes = devices.indexes.filter((i) => !i.includes('idx_devices_token'));
  devices.indexes.push('CREATE INDEX idx_devices_token ON devices (tokenHash)');
  app.save(devices);
}, (app) => {
  const sessions = app.findCollectionByNameOrId('sessions');
  sessions.indexes = sessions.indexes.filter((i) => !i.includes('idx_sessions_token'));
  app.save(sessions);

  const devices = app.findCollectionByNameOrId('devices');
  devices.indexes = devices.indexes.filter((i) => !i.includes('idx_devices_token'));
  app.save(devices);
});
