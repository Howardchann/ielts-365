// app.js —— 本地进度版
const store=require('./utils/store.js');
App({globalData:{store:store,jumpDay:0},onLaunch(){store.init();}});
