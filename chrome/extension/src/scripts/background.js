// Assumes that freedom_connector.js has been loaded.
'use strict';
/* jshint -W098 */

console.log('Initializing chrome extension background page...');

// Chrome App Id for UProxy Packaged Chrome App.
var FREEDOM_CHROME_APP_ID = 'hilnpmepiebcjhibkbkfkjkacnnclkmi';

//Proxy Configer
var proxyConfig = new window.BrowserProxyConfig();
proxyConfig.clearConfig();

// TODO(): remove this if there's no use for it.
chrome.runtime.onInstalled.addListener(function (details) {
  console.log('onInstalled: previousVersion', details.previousVersion);
});
chrome.runtime.onSuspend.addListener(function () {
  console.log('onSuspend');
  //proxyConfig.stopUsingProxy();
})

var onStateChange = new chrome.Event();

var model = {};  // Singleton angularjs model for either popup or options.

var Icon = function() {
  this.set = function(path) {
    // console.log('Setting browser icon to: ' + path);
    chrome.browserAction.setIcon({
      path: path
    });
  };
  this.label = function(text) {
    // console.log('Setting browser badge to: ' + text);
    chrome.browserAction.setBadgeText({
      text: text
    });
  };
};
var icon = new Icon();

// For maintaining a single roster with various sort methods.
var Roster = function() {
  this.all = [];
  this.updateContact = function(c) {
    if (all.indexOf(c) < 0)
      all.push(c);
  }
};
var roster = new Roster();

// User Interface state holder.
// TODO(uzimizu): move UI into its own file in common so firefox can use it.
var UI = function() {
  this.ICON_DIR = '../common/ui/icons/';

  this.notifications = 0;
  this.splashPage = !this.loggedIn();
  this.rosterNudge = false;
  this.advancedOptions = false;
  this.searchBar = true;

  this.isProxying = false;  // Whether we are proxying through someone.
  this.accessIds = 0;  // How many people are proxying through us.

  // Keep track of currently viewed contact and instance.
  this.contact = null;
  this.instance = null;

  // If we are proxying, keep track of the instance.
  this.proxy = null;
};

UI.prototype.setNotifications = function(n) {
  if (n > 0) {
    this.setLabel(n);
  } else {
    this.setLabel('');
  }
  this.notifications = n < 0? 0 : n;
};
UI.prototype.decNotifications = function(n) {
  this.setNotifications(this.notifications - 1);
};

UI.prototype.setIcon = function(iconFile) {
  chrome.browserAction.setIcon({
    path: this.ICON_DIR + iconFile
  });
};
UI.prototype.setLabel = function(text) {
  chrome.browserAction.setBadgeText({ text: '' + text });
};

UI.prototype.setProxying = function(isProxying) {
  this.isProxying = isProxying;
  if (isProxying) {
    this.setIcon('uproxy-19-p.png');
  } else {
    this.setIcon('uproxy-19.png');
  }
};

UI.prototype.setClients = function(numClients) {
  this.numClients = numClients;
  if (numClients > 0) {
    chrome.browserAction.setBadgeBackgroundColor({color: '#008'});
    this.setLabel('↓');
  } else {
    chrome.browserAction.setBadgeBackgroundColor({color: '#800'});
  }
}

// Determine whether UProxy is connected to |network|.
UI.prototype.isOnline = function(network) {
  return (model && model.identityStatus &&
          model.identityStatus[network] &&
          'online' == model.identityStatus[network].status);
};
UI.prototype.isOffline = function(network) {
  return (!model || !model.identityStatus ||
          !model.identityStatus[network] ||
          'offline' == model.identityStatus[network].status);
};
// Whether UProxy is logged in to *any* network.
UI.prototype.loggedIn = function() {
  return this.isOnline('google') || this.isOnline('facebook');
};
UI.prototype.loggedOut = function() {
  return this.isOffline('google') && this.isOffline('facebook');
};


// Make sure counters and UI-only state holders correctly reflect the model.
UI.prototype.synchronize = function() {
  // Count up notifications
  var n = 0;
  for (var userId in model.roster) {
    var user = model.roster[userId];
    if (user.hasNotification) {
      n++;
    }
  }
  this.setNotifications(n);

  // Run through instances, count up clients.
  var c = 0;
  for (var iId in model.instances) {
    var instance = model.instances[iId];
    if ('running' == instance.status.client) {
      c++;
    }
    if ('running' == instance.status.proxy) {
      this.isProxying = true;
    }
  }
  this.setClients(c);

  // Generate list ordered by names.
  var uids = Object.keys(model.roster);
  var names = uids.map(function(id) { return model.roster[id].name; });
  names.sort();
};

var ui = new UI();  // This singleton is referenced in both options and popup.

// Connect to the App.
var appChannel = new FreedomConnector(FREEDOM_CHROME_APP_ID, {
    name: 'uproxy-extension-to-app-port' });

function wireUItoApp() {
  console.log('Wiring UI to backend...');

  appChannel.on('state-change', function(patchMsg) {
    console.log("state-change(patch: ", patchMsg);
    // For resetting state, don't change model object (there are references to
    // it Angular, instead, replace keys, so the watch can catch up);
    if (patchMsg[0].path === '') {
      for (var k in model) {
        delete model[k];
      }
      for (var k in patchMsg[0].value) {
        model[k] = patchMsg[0].value[k];
      }
    } else {
      // Check if the operation should be add or replace.
      patchMsg.op = 'replace';
      jsonpatch.apply(model, patchMsg);
    }

    ui.synchronize();
    checkRunningProxy();
    /*
    // Run through roster if necessary.
    if (patch[0].path.indexOf('roster') >= 0) {
      // - Ensure it's sorted alphabetically.
      console.log('roster edit. ' + patch[0].path);
      // - Count up notifications.
      $rootScope.notifications = 0;
      // var sortedIds = Object.keys(model.roster);
      // console.log(sortedIds);
      // sortedIds.sort();
      // var sortedRoster = {};
      var rosterByName = {};
      for (var userId in model.roster) {
        // sortedRoster[userId] = model.roster[userId];
        var user = model.roster[userId];
        roster.updateContact(user);
        $rootScope.notifications += user.hasNotification? 1 : 0;
        // rosterByName[user.name] = user;
      }
      // var sortedNames = Object.keys(rosterByName);
      // console.log(sortedNames);
      // var sortedRoster = {};
      // sortedNames.sort();
      // for (var name in sortedNames) {
        // sortedRoster[name] = rosterByName[name];
      // }
      // $rootScope.roster = sortedRoster;
      if ($rootScope.notifications > 0) {
        icon.label('' + $rootScope.notifications);
      }
      $rootScope.roster = roster;
    }
    */

    // This event allows angular to bind listeners and update the DOM.
    onStateChange.dispatch(patchMsg);
  });
  console.log('Wiring UI to backend done.');
}
// Attach state-change listener to update UI from the backend.
appChannel.onConnected.addListener(wireUItoApp);


function reconnectToApp() {
  console.log('Disconnected from App! Attempting to reconnect...');
  appChannel.connect();
}


function initialize() {
  // ui-ready tells uproxy.js to send over *all* the state.
  appChannel.emit('ui-ready');
}

function checkRunningProxy() {
  if (model && model.instances) {
    for (var k in model.instances) {
      if (model.instances.hasOwnProperty(k) && model.instances[k].status &&
          model.instances[k].status.proxy) {
        if (model.instances[k].status.proxy == 'running') {
          proxyConfig.startUsingProxy();
          return;
        } 
      }
    }
  }
  proxyConfig.stopUsingProxy();
}

// Automatically attempt to reconnect when disconnected.
appChannel.onConnected.addListener(initialize);
appChannel.onDisconnected.addListener(reconnectToApp);
window.onunload = function() {
  appChannel.onConnected.removeListener(wireUItoApp);
};


console.log('Connecting to App...');
var connectedToApp = false;
appChannel.connect();
