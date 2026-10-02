import { describe, expect, it, vi } from "vitest";

import { stopCaptureTracks } from "@/lib/multimodal-capture";



interface FakeTrack {
  kind: string;
  readyState: "live" | "ended";
  stop: () => void;
}

function track(kind: string): FakeTrack {
  const fake: FakeTrack = {
    kind,
    readyState: "live",
    stop: vi.fn(() => {
      fake.readyState = "ended";
    }),
  };
  return fake;
}

function stream(...tracks: FakeTrack[]): MediaStream {
  return { getTracks: () => tracks } as unknown as MediaStream;
}

describe("desligamento da captura", () => {
  it("para **todas** as tracks, e nao so a primeira", () => {
    /*
      Uma stream de camera traz video e, dependendo da requisicao, audio junto.
      Parar so a primeira deixa o microfone vivo com o LED apagado — o pior dos
      dois mundos: a pessoa nao ve que ainda esta sendo captada.
    */
    const video = track("video");
    const audio = track("audio");
    stopCaptureTracks(stream(video, audio));

    expect(video.stop).toHaveBeenCalledTimes(1);
    expect(audio.stop).toHaveBeenCalledTimes(1);
    expect([video.readyState, audio.readyState]).toEqual(["ended", "ended"]);
  });

  it("uma stream sem tracks nao lanca", () => {
    // Acontece quando a permissao foi revogada antes do fim da sessao.
    expect(() => stopCaptureTracks(stream())).not.toThrow();
  });

  it("chamar duas vezes e seguro", () => {
    /*
      O `capture-view` desliga no fim da sessao e de novo no cleanup do efeito.
      Se a segunda chamada lancasse, o desmonte quebraria e o React deixaria o
      componente num estado sujo — com as tracks ja paradas, mas a tela achando
      que a sessao continua.
    */
    const video = track("video");
    const alvo = stream(video);
    stopCaptureTracks(alvo);
    expect(() => stopCaptureTracks(alvo)).not.toThrow();
    expect(video.stop).toHaveBeenCalledTimes(2);
  });

  it("segunda sessao recebe streams novas, e nenhuma track antiga sobrevive", () => {
    /*
      A regressao de segunda sessao, no nivel que um teste alcanca.

      Sessao 1 pega camera e microfone e encerra; sessao 2 pede de novo. O que
      nao pode acontecer e a sessao 2 herdar qualquer track da 1 — e por isso a
      asserção olha o `readyState` de **todas** as tracks da primeira, e nao
      apenas se `stop` foi chamado.
    */
    const primeira = { camera: track("video"), microfone: track("audio") };
    const sessao1 = [stream(primeira.camera), stream(primeira.microfone)];
    for (const alvo of sessao1) stopCaptureTracks(alvo);

    const segunda = { camera: track("video"), microfone: track("audio") };
    expect(Object.values(primeira).every((t) => t.readyState === "ended")).toBe(true);
    expect(Object.values(segunda).every((t) => t.readyState === "live")).toBe(true);

    // E as tracks da primeira nao sao as mesmas instancias da segunda.
    expect(segunda.camera).not.toBe(primeira.camera);
    expect(segunda.microfone).not.toBe(primeira.microfone);
  });

  it("parar a camera nao encerra a stream do microfone", () => {
    /*
      Sao streams independentes de proposito. Se desligar a camera derrubasse o
      microfone, encerrar a analise visual no meio da sessao levaria a
      transcricao junto — e o relatorio registraria ausencia de fala onde houve
      fala.
    */
    const camera = track("video");
    const microfone = track("audio");
    stopCaptureTracks(stream(camera));

    expect(camera.readyState).toBe("ended");
    expect(microfone.readyState).toBe("live");
    expect(microfone.stop).not.toHaveBeenCalled();
  });
});
