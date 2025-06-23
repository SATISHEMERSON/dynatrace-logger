# dynatrace-logger

Winston logger transport for Dynatrace with Express HTTP access middleware.

## Usage

```js
import express from 'express';
import { logger, httpLogger } from 'dynatrace-logger';

const app = express();
app.use(httpLogger);

app.get('/hello', (req, res) => {
  logger.info('Hello endpoint hit');
  res.send('Hello!');
});
```