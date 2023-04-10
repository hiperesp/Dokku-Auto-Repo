import express from 'express'
import nunjucks from 'nunjucks'
import dotenv from 'dotenv'
import cookieParser from 'cookie-parser'

import System from './model/System.js';
import buildSearchParams from './helpers/buildSearchParams.js';

dotenv.config({path: process.cwd() + '/.env'})

const app = express()

// Configurar o Express para receber dados do formulário via POST
app.use(express.urlencoded({extended: true}))

// Configurar pasta de assets estáticos
app.use(express.static('view/static'));

// Configurar o Nunjucks como mecanismo de visualização padrão do Express
app.set('view engine', 'njk')

// Configurar a pasta onde estão armazenados os templates do Nunjucks
const nunjucksEnv = nunjucks.configure('view', {
    autoescape: true,
    express: app
})

nunjucksEnv.addFilter('timeago', function(time) {
    if(!time) return 'never';
    const seconds = Math.floor((Date.now() - time) / 1000);
    if(seconds < 10) {
        return 'just now';
    }
    if(seconds < 60) {
        const scale = seconds === 1 ? 'second' : 'seconds';
        return `${seconds} ${scale} ago`;
    }
    const minutes = Math.floor(seconds / 60);
    if(minutes < 60) {
        const scale = minutes === 1 ? 'minute' : 'minutes';
        return `${minutes} ${scale} ago`;
    }
    const hours = Math.floor(minutes / 60);
    if(hours < 24) {
        const scale = hours === 1 ? 'hour' : 'hours';
        return `${hours} ${scale} ago`;
    }
    const days = Math.floor(hours / 24);
    if(days < 7) {
        const scale = days === 1 ? 'day' : 'days';
        return `${days} ${scale} ago`;
    }
    const weeks = Math.floor(days / 7);
    if(weeks < 4) {
        const scale = weeks === 1 ? 'week' : 'weeks';
        return `${weeks} ${scale} ago`;
    }
    const months = Math.floor(days / 30);
    if(months < 12) {
        const scale = months === 1 ? 'month' : 'months';
        return `${months} ${scale} ago`;
    }
    const years = Math.floor(days / 365);
    const scale = years === 1 ? 'year' : 'years';
    return `${years} ${scale} ago`;
});

// Configurar o cookie parser
app.use(cookieParser())

// Configurar o middleware de autenticação
app.use((request, response, next) => {
    if(!process.env.AUTH_USER || !process.env.AUTH_PASSWORD) {
        response.status(500).send('Missing authentication credentials in .env file: AUTH_USER and AUTH_PASSWORD')
        return
    }

    if(request.path === '/login') {
        next()
        return
    }

    const authData = {
        username: request.cookies?.username,
        password: request.cookies?.password,
    }

    if(authData.username === process.env.AUTH_USER && authData.password === process.env.AUTH_PASSWORD) {
        next()
        return
    }

    response.status(401).render('pages/login.njk', {
        originalUrl: request.originalUrl,
    })
})

const system = System.instance()

app.post('/login', (request, response) => {
    const authData = {
        username: request.body?.username,
        password: request.body?.password,
    }

    response.cookie('username', authData.username)
    response.cookie('password', authData.password)

    const redirect = request.body?.redirect || '/'
    response.redirect(redirect);
})
app.get('/logout', (request, response) => {
    response.clearCookie('username')
    response.clearCookie('password')
    response.redirect('/');
})

app.get('/', function(request, response) {
    response.render('pages/namespaces.njk', {
        system: system.toJson(),
    })
})

app.get('/:namespace', function(request, response) {
    
    const namespace = system.namespaces.find(namespace => namespace.name === request.params.namespace)
    if(!namespace) return response.status(404).send('Namespace not found')

    response.render('pages/apps.njk', {
        system: system.toJson(),
        namespace: namespace.toJson(),
    })
})

app.get('/:namespace/:app', async function(request, response) {

    const namespace = system.namespaces.find(namespace => namespace.name === request.params.namespace)
    if(!namespace) return response.status(404).send('Namespace not found')

    const app = namespace.apps.find(app => app.name === request.params.app)
    if(!app) return response.status(404).send('App not found')

    response.render('pages/app.njk', {
        system: system.toJson(),
        namespace: namespace.toJson(),
        app: app.toJson(),

        tab: request.query.tab || 'overview',
        subtab: request.query.subtab || 'general',
    })
})

app.post('/:namespace/:app/api/logs-view', async function(request, response) {
    const namespace = system.namespaces.find(namespace => namespace.name === request.params.namespace)
    if(!namespace) return response.status(404).send('Namespace not found')

    const app = namespace.apps.find(app => app.name === request.params.app)
    if(!app) return response.status(404).send('App not found')

    response.render('pages/app.njk', {
        system: system.toJson(),
        namespace: namespace.toJson(),
        app: app.toJson(),

        tab: 'api_action_logs',
        data: request.body,
        dataQueryParams: buildSearchParams(request.body),
    })
});

app.get('/:namespace/:app/api/server-sent-events/actions/scale', async function(request, response) {
    const namespace = system.namespaces.find(namespace => namespace.name === request.params.namespace)
    if(!namespace) return response.status(404).send('Namespace not found')

    const app = namespace.apps.find(app => app.name === request.params.app)
    if(!app) return response.status(404).send('App not found')

    response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    })

    let eventId = 0;
    app.scale(request.query?.process, function(output) {
        response.write(`id: ${eventId++}\n`)
        response.write(`event: stdout\n`)
        response.write(`data: ${JSON.stringify(output)}\n`)
        response.write(`\n`)
    }).catch(function(error) {
        response.write(`id: ${eventId++}\n`)
        response.write(`event: stderr\n`)
        response.write(`data: ${JSON.stringify(error)}\n`)
        response.write(`\n`)
    }).finally(function() {
        response.write(`id: ${eventId++}\n`)
        response.write(`event: done\n`)
        response.write(`data: ${JSON.stringify("Done!")}\n`)
        response.write(`\n`)
        response.end()
    });
});


app.get('/:namespace/:app/api/server-sent-events/logs/:type', async function(request, response) {
    const namespace = system.namespaces.find(namespace => namespace.name === request.params.namespace)
    if(!namespace) return response.status(404).send('Namespace not found')

    const app = namespace.apps.find(app => app.name === request.params.app)
    if(!app) return response.status(404).send('App not found')

    response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    })

    const method = ({
        "app_logs": "realTimeAppLogs",
        "access_logs": "realTimeAccessLogs",
        "error_logs": "realTimeErrorLogs",
    })[request.params.type];

    if(!method) return response.status(404).send('Log type not found')

    let eventId = 0;
    const logging = await app[method](function(stdout) {
        response.write(`id: ${eventId++}\n`)
        response.write(`event: stdout\n`)
        response.write(`data: ${JSON.stringify(stdout)}\n`)
        response.write(`\n`)
    }, function(stderr) {
        response.write(`id: ${eventId++}\n`)
        response.write(`event: stderr\n`)
        response.write(`data: ${JSON.stringify(stderr)}\n`)
        response.write(`\n`)
    });

    request.on('close', () => {
        logging.kill()
        response.end()
    });
});

// Iniciar o servidor
app.listen(3000, function() {
    console.log('Servidor iniciado na porta 3000')
})
