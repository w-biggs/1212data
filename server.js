const mongoose = require('mongoose');
const fs = require('fs');
const addGame = require('./tasks/addGame');

/* Connect to MongoDB */
mongoose.connect('mongodb://127.0.0.1:27017/1212', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useCreateIndex: true,
});

/* Check connection */
const db = mongoose.connection;

const writeDebug = function writeDebug(data) {
  fs.writeFile('debug.json', JSON.stringify(data, null, 2), (err) => {
    if (err) {
      console.error(err);
    } else {
      console.log('Successfully wrote debug.json.');
    }
  });
};

db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', () => {
  console.log('Connected!');

  addGame('fl3p5v')
    .catch(err => err && console.error(err))
    .then(writeDebug);
});
