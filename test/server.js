import express from 'express';
import fetch from 'node-fetch';
import sharpware from '../src';

const app = express();

// https://assets-cdn.github.com/images/modules/logos_page/Octocat.png

function getS3Image(path) {
  return fetch('https://assets-cdn.github.com/images/modules/logos_page/Octocat.png')
    .then(res => res.body);
}

app.get('/s3/:path', sharpware({
  getImage: ({ params }) => getS3Image(params.path),
}));

app.listen(1337);