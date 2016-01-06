const Promise = require('bluebird');
const Errors = require('common-errors');
const redisKey = require('../utils/key.js');
const emailVerification = require('../utils/send-email.js');
const jwt = require('../utils/jwt.js');

module.exports = function verifyChallenge(opts) {
  // TODO: add security logs
  // var remoteip = opts.remoteip;
  const { token, namespace, username } = opts;
  const { redis, config } = this;
  const audience = opts.audience || config.defaultAudience;

  function verifyToken() {
    return emailVerification.verify.call(this, token, namespace, config.validation.ttl > 0);
  }

  function verifyUserExists() {
    const userKey = redisKey(username, 'data');
    return redis
      .hexists(userKey, 'active')
      .then(function fieldExists(exists) {
        if (!exists) {
          throw new Errors.HttpStatusError(404, 'user does not exist');
        }
      })
      .return(username);
  }

  function activateAccount(user) {
    const userKey = redisKey(user, 'data');

    // set to active
    return redis
      .pipeline()
      .hget(userKey, 'active')
      .hset(userKey, 'active', 'true')
      .persist(userKey) // WARNING: this is very important, otherwise we will lose user's information in 30 days
      .sadd(config.redis.userSet, user)
      .exec()
      .spread(function pipeResponse(isActive) {
        const status = isActive[1];
        if (status === 'true') {
          throw new Errors.HttpStatusError(413, `Account ${user} was already activated`);
        }
      })
      .return(user);
  }

  function returnUserInfo(user) {
    return jwt.login.call(this, user, audience);
  }

  function postHook(user) {
    return this.postHook('users:activate', user, audience);
  }

  let promise = Promise.bind(this);

  if (!username) {
    promise = promise.then(verifyToken);
  } else {
    promise = promise.then(verifyUserExists);
  }

  return promise
    .then(activateAccount)
    .tap(postHook)
    .then(returnUserInfo);
};