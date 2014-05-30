var path = require('path');

var Q = require('q');
var wrench = require('wrench');
var _ = require('lodash');
var grunt = require('grunt');

var pkg = require('../package.json');
var git = require('./git');

var copy = require('./util').copy;

function getCacheDir() {
  return '.gh-pages';
}

function getRemoteUrl(dir, remote) {
  var repo;
  return git(['config', '--get', 'remote.' + remote + '.url'], dir)
      .progress(function(chunk) {
        repo = String(chunk).split(/[\n\r]/).shift();
      })
      .then(function() {
        if (repo) {
          return Q.resolve(repo);
        } else {
          return Q.reject(new Error(
              'Failed to get repo URL from options or current directory.'));
        }
      })
      .fail(function(err) {
        return Q.reject(new Error(
            'Failed to get remote.origin.url (task must either be run in a ' +
            'git repository with a configured origin remote or must be ' +
            'configured with the "repo" option).'));
      });
}

function getRepo(options) {
  if (options.repo) {
    return Q.resolve(options.repo);
  } else {
    return getRemoteUrl(process.cwd(), 'origin');
  }
}


/**
 * Push a git branch to a remote (pushes gh-pages by default).
 * @param {Object} config Publish options.
 * @param {function(Error)} done Called upon completion.
 */
exports.publish = function publish(config, done) {
  var defaults = {
    add: false,
    git: 'git',
    clone: getCacheDir(),
    dotfiles: false,
    branch: 'gh-pages',
    remote: 'origin',
    base: process.cwd(),
    src: '**/*',
    only: '.',
    push: true,
    message: 'Updates',
    silent: false,
    logger: function() {}
  };

  // override defaults with any task options
  var options = _.extend({}, defaults, config);

  if (!grunt.file.isDir(options.base)) {
    done(new Error('The "base" option must be an existing directory'));
    return;
  }

  var files = grunt.file.expand({
    filter: 'isFile',
    cwd: options.base,
    dot: options.dotfiles
  }, options.src);

  if (!Array.isArray(files) || files.length === 0) {
    done(new Error('Files must be provided in the "src" property.'));
    return;
  }

  var only = grunt.file.expand({cwd: options.base}, options.only);

  function log(message) {
    if (!options.silent) {
      options.logger(message);
    }
  }

  git.exe(options.git);

  var repoUrl;
  getRepo(options)
      .then(function(repo) {
        repoUrl = repo;
        log('Cloning ' + repo + ' into ' + options.clone);
        return git.clone(repo, options.clone, options.branch, options);
      })
      .then(function() {
        return getRemoteUrl(options.clone, options.remote)
            .then(function(url) {
              if (url !== repoUrl) {
                var message = 'Remote url mismatch.  Got "' + url + '" ' +
                    'but expected "' + repoUrl + '" in ' + options.clone +
                    '.  If you have changed your "repo" option, try ' +
                    'running `grunt gh-pages-clean` first.';
                return Q.reject(new Error(message));
              } else {
                return Q.resolve();
              }
            });
      })
      .then(function() {
        // only required if someone mucks with the checkout between builds
        log('Cleaning');
        return git.clean(options.clone);
      })
      .then(function() {
        log('Fetching ' + options.remote);
        return git.fetch(options.remote, options.clone);
      })
      .then(function() {
        log('Checking out ' + options.remote + '/' +
            options.branch);
        return git.checkout(options.remote, options.branch,
            options.clone);
      })
      .then(function() {
        if (!options.add) {
          log('Removing files');
          return git.rm(only.join(' '), options.clone);
        } else {
          return Q.resolve();
        }
      })
      .then(function() {
        log('Copying files');
        return copy(files, options.base, options.clone);
      })
      .then(function() {
        log('Adding all');
        return git.add('.', options.clone);
      })
      .then(function() {
        if (options.user) {
          return git(['config', 'user.email', options.user.email],
              options.clone)
              .then(function() {
                return git(['config', 'user.name', options.user.name],
                    options.clone);
              });
        } else {
          return Q.resolve();
        }
      })
      .then(function() {
        log('Committing');
        return git.commit(options.message, options.clone);
      })
      .then(function() {
        if (options.tag) {
          log('Tagging');
          var deferred = Q.defer();
          git.tag(options.tag, options.clone)
            .then(function() {
                return deferred.resolve();
              })
            .fail(function(error) {
                // tagging failed probably because this tag alredy exists
                log('Tagging failed, continuing');
                options.logger(error);
                return deferred.resolve();
              });
          return deferred.promise;
        } else {
          return Q.resolve();
        }
      })
      .then(function() {
        if (options.push) {
          log('Pushing');
          return git.push(options.remote, options.branch,
              options.clone);
        } else {
          return Q.resolve();
        }
      })
      .then(function() {
        done();
      }, function(error) {
        if (options.silent) {
          error = new Error(
              'Unspecified error (run without silent option for detail)');
        }
        done(error);
      });
};


/**
 * Clean the cache directory.
 */
exports.clean = function clean() {
  wrench.rmdirSyncRecursive(getCacheDir(), true);
};