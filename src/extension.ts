import { spawn } from 'child_process';
import * as vscode from 'vscode';
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
    /**
     * Should be a unique string (like a guid)
     */
    readonly id: string;
    onDidChangeHandles?: vscode.Event<void>;
    getQuickPickEntryItems?(): vscode.QuickPickItem[];
    handleQuickPick?(item: vscode.QuickPickItem, backEnabled: boolean): Promise<JupyterServerUriHandle | 'back' | undefined>;
    /**
     * Given the handle, returns the Jupyter Server information.
     */
    getServerUri(handle: JupyterServerUriHandle): Promise<IJupyterServerUri>;
    /**
     * Gets a list of all valid Jupyter Server handles that can be passed into the `getServerUri` method.
     */
    getHandles?(): Promise<JupyterServerUriHandle[]>;
}

interface ICachedServer extends IJupyterServerUri {
    // serverProcess: any;
}

class LocalServer implements IJupyterUriProvider {
    id: string = 'local';
    private _servers: Map<JupyterServerUriHandle, IJupyterServerUri> = new Map();
    private _eventEmitter = new vscode.EventEmitter<void>();
    onDidChangeHandles = this._eventEmitter.event;

    constructor(readonly context: vscode.ExtensionContext) {
        const cache = context.workspaceState.get<IJupyterServerUri[]>('servercache') ?? [];
        this.updateServers(cache);
    }

    async createServer(): Promise<JupyterServerUriHandle> {
        const baseUrl = 'http://localhost:8888';
        const token = '68def3b2dd9daef67dc02ca2098ddf0b00a821c8ce7c0323';

        const server = {
            baseUrl,
            token,
            displayName: 'GitHub jupyter server',
            authorizationHeader: { Authorization: `token ${token}` },
        };

        this._servers.set(server.baseUrl, server);
        this._eventEmitter.fire();
        this.context.workspaceState.update('servercache', Array.from(this._servers.values()));

        return server.baseUrl;
    }

    updateServers(servers: IJupyterServerUri[]) {
        servers.forEach(server => {
            this._servers.set(server.baseUrl, server);
        });

        this._eventEmitter.fire();
    }

    clearServers() {
        this._servers.clear();
        this._eventEmitter.fire();
        this.context.workspaceState.update('servercache', []);
    }

    async getServerUri(handle: string): Promise<IJupyterServerUri> {
        const server = this._servers.get(handle);

        if (server) {
            return server;
        }
        throw new Error(`Server ${handle} not found`);
    }

    async getHandles(): Promise<JupyterServerUriHandle[]> {
        return Array.from(this._servers.keys());
    }

}

export async function activate(context: vscode.ExtensionContext) {
    const jupyter = vscode.extensions.getExtension('ms-toolsai.jupyter');
    if (jupyter) {
        await jupyter.activate();
    }
    if (jupyter?.exports) {
        const api = jupyter.exports;
        const localServer = new LocalServer(context);

        api.registerRemoteServerProvider(localServer);

        context.subscriptions.push(vscode.commands.registerCommand('kernel-resolver.connectToGitHub', async () => {
            return new Promise<void>(async resolve => {
                const handle = await localServer.createServer();
                api.addRemoteJupyterServer('local', handle);
                setTimeout(() => {
                    resolve();
                }, 3000);
            })

        }));

        context.subscriptions.push(vscode.commands.registerCommand('kernel-resolver.clearConnections', () => {
            localServer.clearServers();
        }));
    }
}
// this method is called when your extension is deactivated
export function deactivate() {}                    ``