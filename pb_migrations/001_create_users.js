migrate((app) => {
  const collection = app.findCollectionByNameOrId('users');

  collection.fields.add(new TextField({ name: 'username', required: true, min: 3, max: 20, pattern: '^[a-zA-Z0-9_]+$' }));
  collection.fields.add(new DateField({ name: 'lastUsernameChangeAt', required: false }));
  collection.fields.add(new BoolField({ name: 'isVerified', required: false }));
  collection.fields.add(new BoolField({ name: 'isArchitect', required: false }));
  collection.fields.add(new SelectField({ name: 'accountType', required: true, maxSelect: 1, values: ['lover', 'musician', 'artist', 'content_creator', 'brand', 'vintage_reseller', 'label', 'studio'] }));
  collection.fields.add(new FileField({ name: 'avatar', required: false, maxSelect: 1, maxSize: 2097152, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] }));
  collection.fields.add(new DateField({ name: 'birthday', required: false }));
  collection.fields.add(new SelectField({ name: 'tier', required: true, maxSelect: 1, values: ['free', 'pro', 'creator'] }));
  collection.fields.add(new TextField({ name: 'emailVerificationCode', required: false, max: 6 }));
  collection.fields.add(new DateField({ name: 'emailVerificationCodeExpiry', required: false }));

  collection.indexes = [...collection.indexes, 'CREATE UNIQUE INDEX idx_users_username ON users (username)'];

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('users');
  const names = ['username', 'lastUsernameChangeAt', 'isVerified', 'isArchitect', 'accountType', 'avatar', 'birthday', 'tier', 'emailVerificationCode', 'emailVerificationCodeExpiry'];
  for (const name of names) {
    collection.fields.removeByName(name);
  }
  app.save(collection);
});
