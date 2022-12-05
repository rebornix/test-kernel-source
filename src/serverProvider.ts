import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { spawnAsync } from './helpers';
var net = require('net');

async function getPortFree() {
    return new Promise<string>(res => {
        const srv = net.createServer();
        srv.listen(0, () => {
            const port = srv.address().port;
            srv.close((err: any) => res(port));
        });
    });
}

export type JupyterServerUriHandle = string;

export interface IJupyterServerUri {
    baseUrl: string;
    token: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authorizationHeader: any; // JSON object for authorization header.
    expiration?: Date; // Date/time when header expires and should be refreshed.
    displayName: string;
}

export interface IJupyterUriProvider {
    readonly id: string;
    displayName?: string;
    onDidChangeHandles: vscode.Event<void>;
    getQuickPickEntryItems(): Promise<vscode.QuickPickItem[]> | vscode.QuickPickItem[];
    handleQuickPick?(item: vscode.QuickPickItem, backEnabled: boolean): Promise<JupyterServerUriHandle | 'back' | undefined>;
    getServerUri(handle: JupyterServerUriHandle): Promise<IJupyterServerUri>;
    getHandles(): Promise<JupyterServerUriHandle[]>;
    removeHandle(handle: JupyterServerUriHandle): Promise<void>;
}


interface IQuickPick extends vscode.QuickPickItem {
    id: string;
}

interface IContainerServer extends IJupyterServerUri {
    handle: string;
}

const parseServerInfoFromLog = (data: string, port: string, handle: string) => {
    const token = parseTokenFromLog(data);

    if (token) {
        const server: IContainerServer = {
            handle: handle,
            baseUrl: `http://127.0.0.1:${port}`,
            token: token,
            displayName: handle,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            authorizationHeader: { Authorization: `token ${token}` },
        };
        return server;
    }

    return undefined;
};

function parseTokenFromLog(data: string) {
    const url = data.match(/http:\/\/127\.0\.0\.1:8888\/lab\?token=([a-zA-Z0-9]+)/);

    if (url) {
        const token = url[1];
        return token;
    }
    return undefined;
}

class JupyterServerContainer {
    constructor(
        readonly handle: JupyterServerUriHandle,
        readonly port: string,
        private _serverInfo: IJupyterServerUri | undefined
    ) {
    }

    async getServerInfo(): Promise<IJupyterServerUri> {
        if (!this._serverInfo) {
            this._serverInfo = await this._getServerInfo();
            return this._serverInfo;
        } else {
            return this._serverInfo;
        }
    }

    private async _getServerInfo(): Promise<IJupyterServerUri> {
        
        const inspectPromise = new Promise<string>(resolve => {
            const proc = spawn('docker', [
                'start',
                '-a',
                this.handle
            ], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            proc.stdout.on('data', (data) => {
                console.log(`stdout attach: ${data}`); 
                const str = data.toString();
                const token = parseTokenFromLog(str);
                if (token) {
                    resolve(token);
                }
            });
            proc.stderr.on('data', (data) => {
                console.log(`stderr attach: ${data}`); 
                const str = data.toString();
                const token = parseTokenFromLog(str);
                if (token) {
                    resolve(token);
                }
            });
            // TODO handle close
        });

        const token = await inspectPromise;

        // get port used in docker container
        const tokenPromise = new Promise<string>(resolve => {
            const proc = spawn('docker', [
                'container',
                'port',
                this.handle
            ], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            proc.stdout.on('data', (data) => {
                console.log(`stdout port: ${data}`); 
                const str = data.toString().trim();
                const port = str.split(':')[1];
                console.log('port', port);
                resolve(port);
                proc.kill();
            });
        });

        const port = await tokenPromise;
        return {
            baseUrl: `http://127.0.0.1:${port}`,
            token: token,
            displayName: this.handle,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            authorizationHeader: { Authorization: `token ${token}` },
        };
    }
}

export class ContainerServer implements IJupyterUriProvider {
    id: string = 'jupyter-server-provider-containers';
    displayName: string = 'Jupyter Server from Docker Containers';
    private _handles: JupyterServerContainer[] = [];
    private _eventEmitter = new vscode.EventEmitter<void>();
    onDidChangeHandles = this._eventEmitter.event;
    private _initHandlesPromise: Promise<void>;

    constructor() {
        // init
        this._initHandlesPromise = this._init();
    }

    private async _init() {
        // docker ps find all containers for image
        const parseContainersPromise = new Promise<JupyterServerContainer[]>(resolve => {
            const proc = spawn('docker', [
                'ps',
                '-a',
                '-f',
                'ancestor=jupyter/scipy-notebook:85f615d5cafa',
                '--format',
                '{{.ID}} {{.Names}} {{.Status}}'
            ], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            proc.stdout.on('data', (data) => {
                console.log(`stdout: ${data}`);
                // parse data to get docker container id and name
                const servers = [];
                const lines = data.toString().split(/\r?\n/);
                for (const line of lines) {
                    const matches = /^(\w+)\s([\w\-]+)\s(.*)/.exec(line);
                    if (matches && matches.length === 4) {
                        const containerId = matches[1];
                        const handleId = matches[2];
                        const status = matches[3];
                        console.log(`containerId: ${containerId}, handleId: ${handleId}, status: ${status}`);
                        const server = new JupyterServerContainer(handleId, '8888', undefined);
                        servers.push(server);
                    }
                }

                resolve(servers);
            });

            proc.stderr.on('data', (data) => {
                console.log(`stderr: ${data}`);
            });

            proc.on('close', (code) => {
                console.log(`child process exited with code ${code}`);
                resolve([]);
            });
        });

        const servers = await parseContainersPromise;
        this._handles = servers;
        this._eventEmitter.fire();
    }

    getQuickPickEntryItems(): IQuickPick[] {
        return [
            {
                id: 'connect-scientific-python',
                label: 'Scientific Jupyter Notebook Python Stack (jupyter/scipy-notebook)',
                detail: 'jupyter/scipy-notebook:85f615d5cafa'
            }
        ];
    }
    async handleQuickPick(item: IQuickPick, backEnabled: boolean): Promise<string | undefined> {
        if (item.id === 'connect-scientific-python') {
            return vscode.window.withProgress<string | undefined>({ location: vscode.ProgressLocation.Notification, title: 'Starting Jupyter Server' }, async (progress) => {
                const promise = new Promise<string | undefined>(async resolve => {

                    // start a process to run docker container and listen and parse its output
                    // find a free port to use for the container

                    const port = await getPortFree();
                    // generate a random handle id
                    const handleId = 'jupyter-server-provider-containers-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                    progress.report({ message: `Building container jupyter/scipy-notebook:85f615d5cafa` });

                    const serverProcess = spawn('docker', [
                        'run',
                        // '-it',
                        '-a', 'stdin', '-a', 'stdout', '-a','stderr',
                        '-p', `${port}:8888`,
                        '--name', handleId,
                        'jupyter/scipy-notebook:85f615d5cafa',
                        'start-notebook.sh', '--NotebookApp.allow_origin_pat=.*', './', '--no-browser'
                    ], {
                        stdio: ['pipe', 'pipe', 'pipe']
                    });
                    serverProcess.stdout.on('data', (data) => {
                        console.log(`stdout: ${data}`);
                    });
                    let handled = false;
                    serverProcess.stderr.on('data', (data) => {
                        // parse stderr for the url and token
                        const str = data.toString();
                        console.log(`stderr: ${str}`);

                        if (handled) {
                            return;
                        }

                        const info = parseServerInfoFromLog(str, port, handleId);
                        if (info) {
                            const server = new JupyterServerContainer(
                                handleId,
                                port,
                                info
                            );

                            this._handles = [server];
                            handled = true;
                            progress.report({ increment: 100 });
                            resolve(handleId);
                            this._eventEmitter.fire();
                        }
                    });
                    serverProcess.on('close', (code) => {
                        console.log(`child process exited with code ${code}`);
                        this._handles = this._handles.filter(h => h.handle !== handleId);
                        this._eventEmitter.fire();
                    });
                });

                return promise;
            });

        }

        return undefined;
    }
    async getServerUri(handle: string): Promise<IJupyterServerUri> {
        const info = this._handles.find(h => h.handle === handle);
        if (!info) {
            throw new Error('Invalid handle');
        }
        return info.getServerInfo();
    }

    async getHandles(): Promise<string[]> {
        await this._initHandlesPromise;
        return this._handles.map(h => h.handle);
    }

    async removeHandle(handle: JupyterServerUriHandle): Promise<void> {
        this._handles = this._handles.filter(h => h.handle !== handle);

        try {
            const result = await spawnAsync('docker', [
                'rm',
                '-f',
                handle
            ]);
            console.log(result.code, result.hasStdErr);
            // assert.strictEqual(result.code, 0, 'Expect zero exit code');
        } catch (error) {
            console.log('Error thrown');
            console.log(error);
        }	

        this._eventEmitter.fire();
    }
}
